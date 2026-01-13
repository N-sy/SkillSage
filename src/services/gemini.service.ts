
import { Injectable, signal } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';
import { PlanConfig, LearningPlan, ChatMessage, GroundingChunk, Resource, LearningFramework, AssessmentMessage, QuizQuestion, Goal, UserSchedule } from '../models';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private genAI: GoogleGenAI | undefined;
  public error = signal<string | null>(null);

  constructor() {
    // Check if the API key is available in the environment variables
    // process.env.API_KEY is replaced by Vite at build time
    const apiKey = process.env.API_KEY;
    
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey: apiKey });
    } else {
      console.error('API Key is missing. The app will not function correctly until configured.');
      this.error.set('MISSING_API_KEY');
    }
  }

  private isLongTermGoal(goal?: string): boolean {
    if (!goal) return false;
    const lowerCaseGoal = goal.toLowerCase();
    const longTermKeywords = ['6 months', 'lifelong', 'year', 'years', 'long-term', 'long term'];
    return longTermKeywords.some(keyword => lowerCaseGoal.includes(keyword));
  }

  private checkConfig(): boolean {
      if (!this.genAI) {
          this.error.set('MISSING_API_KEY');
          return false;
      }
      return true;
  }

  async assessSkill(config: PlanConfig, conversation: AssessmentMessage[]): Promise<string> {
    if (!this.checkConfig()) return "API Key missing. Please configure the app.";

    this.error.set(null);
    try {
        const lastUserMessage = conversation[conversation.length - 1];
        const history = conversation.slice(0, -1);

        let timelineContext = '';
        const standardGoals: Goal[] = ['3 Months', '6 Months', 'Lifelong'];
        if (config.planType === 'time' && config.goal && !standardGoals.includes(config.goal as Goal)) {
          timelineContext = `
          IMPORTANT CONTEXT: The user has specified a custom learning timeframe of "${config.goal}". As part of your assessment, if this timeframe seems unrealistic (either too short or too long) for learning "${config.skill}", you should ask a question to clarify their expectations or suggest a more realistic timeframe. For example: "I see you want to learn this in 2 weeks. That's ambitious! Are you looking for a brief overview, or do you have a lot of time to dedicate?". Only ask this if the timeframe is genuinely questionable. Otherwise, proceed with the normal skill assessment.
          `;
        }

        const basePrompt = `You are an expert skills assessor. Your goal is to determine a user's proficiency in "${config.skill}" by asking a series of open-ended questions. Review the conversation history and the user's latest message (which may include media like images or audio).
        ${timelineContext}
        
        Conversation History:
        ${history.map(m => `${m.role}: ${m.text}`).join('\n')}

        Based on the entire conversation, do one of two things:
        1. If you have enough information (after 2 user responses), provide a concise, one-sentence summary of their estimated skill level (e.g., 'The user is a beginner with some theoretical knowledge but no practical experience.') and append the special token '[[ASSESSMENT_COMPLETE]]'.
        2. If you need more information, ask exactly one more follow-up question to clarify their experience or knowledge. Do not add any preamble, just ask the question.`;

        const parts: ({ text: string } | { inlineData: { mimeType: string; data: string; } })[] = [];

        if (lastUserMessage.attachment) {
            parts.push({ text: basePrompt });
            parts.push({
                text: `User's latest message: ${lastUserMessage.text}`
            });
            parts.push({
                inlineData: {
                    mimeType: lastUserMessage.attachment.mimeType,
                    data: lastUserMessage.attachment.data,
                }
            });
        } else {
             parts.push({ text: basePrompt + `\nUser's latest message: ${lastUserMessage.text}` });
        }

        const response = await this.genAI!.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: parts }
        });

        return response.text;
    } catch (e) {
        console.error('Error during skill assessment:', e);
        this.error.set('Failed to process assessment. Please try again.');
        return "I'm having trouble understanding. Could you please rephrase? [[ASSESSMENT_COMPLETE]]";
    }
  }

  async generateLearningPlan(config: PlanConfig, assessment: string): Promise<Omit<LearningPlan, 'suggestedSkills' | 'id' | 'framework' | 'assessmentSummary' | 'creationDate'> | null> {
    if (!this.checkConfig()) return null;
    
    this.error.set(null);
    let rawResponseText = '';

    let frameworkPrompt = '';
    if (config.framework === 'disss') {
        frameworkPrompt = `
        Please structure this plan using the DiSSS (Deconstruction, Selection, Sequencing, Stakes) and CaFE (Compression, Frequency, Encoding) learning frameworks.
        - Deconstruction: Break the skill into the smallest possible components.
        - Selection: Identify the 20% of components that will yield 80% of the results (Pareto Principle).
        - Sequencing: Order the selected components into a logical progression.
        - Stakes: (For the user to implement) Suggest adding a small, tangible commitment to encourage follow-through.
        - Compression: Create summaries or "cheatsheets" for each week.
        - Frequency & Encoding: Design daily tasks that involve recall and practical application to move knowledge from short-term to long-term memory.
        `;
    }

    let goalStatement = '';
    let concisenessInstruction = '';
    const isLongTerm = this.isLongTermGoal(config.goal) || config.planType === 'purpose';

    if (config.planType === 'time' && config.goal) {
      goalStatement = `Their goal is to learn this over a period of '${config.goal}'. If the user provided a custom timeframe that you questioned during the assessment, you can adjust the plan's length to be more realistic, but you should mention that you have done so in the plan's first weekly title.`;
    } else if (config.planType === 'purpose' && config.purpose) {
      goalStatement = `Their primary purpose for learning this is: "${config.purpose}". The plan should be optimized to help them achieve this specific purpose, and the duration should be whatever is most appropriate for achieving it.`;
    }
    
    if (isLongTerm) {
      concisenessInstruction = 'IMPORTANT: This is a long-term plan. To ensure it fits within the response size, please be very concise. Keep all task descriptions to a single, short sentence.';
    }

    const commitmentInvolvesLowDays = ['1 day', '2 days', '3 days'].some(d => config.timeCommitment.includes(d));
    const detailedWeeks = commitmentInvolvesLowDays ? 8 : 4;
    
    let structureInstruction = '';
    if (isLongTerm) {
        structureInstruction = `
        This is a long-term learning plan. Structure the response using a "progressive detail" approach:
        1.  **Detailed Start:** Create DETAILED, week-by-week modules with daily tasks ONLY for the FIRST ${detailedWeeks} WEEKS. Use a 'week' property from 1 to ${detailedWeeks} for these, and titles like "Week 1: Foundations".
        2.  **Milestone-Based Roadmap:** AFTER the first ${detailedWeeks} weeks, create HIGHER-LEVEL modules that represent future phases or milestones.
            - The 'title' for these modules MUST reflect a broader timeframe, for example: "Months 3-4: Core Concepts", "Months 5-6: First Major Project", "Year 1 - Q3: Advanced Topics", or "Year 2: Mastery & Specialization". DO NOT title them "Week ${detailedWeeks + 1}", "Week ${detailedWeeks + 2}", etc.
            - The 'week' property for these milestone modules should continue sequentially (${detailedWeeks + 1}, ${detailedWeeks + 2}, etc.), but the 'title' is what conveys the broader timeframe.
        3.  **Milestone Content:** For these higher-level milestone modules, use the 'dailyTasks' array to create a high-level checklist of major goals, projects, or skills to master during that phase. Group all checklist items under a single 'day' property (e.g., day: 1). The 'tasks' in this list should be major goals, not granular daily activities.
        This provides a detailed start and a strategic, easy-to-understand roadmap for the journey ahead.
        `;
    } else {
        structureInstruction = `
        - The plan must be broken down into weekly modules.
        - Based on their time commitment, each weekly module must be broken down into daily tasks for the specific number of days they are available. For example, if they commit to '3 days per week', you MUST generate tasks for exactly 3 days within each week. The tasks for each day should be substantial enough to fill their session time.
        `;
    }

    let customResourcePrompt = '';
    if (config.customResources) {
        customResourcePrompt = `
        The user has provided the following text as an additional resource. You should prioritize information from this text when relevant, but you are still free to use your own knowledge and other resources to create a comprehensive plan. Do not just summarize the provided text; integrate its key concepts into the learning path.
        ---
        USER-PROVIDED RESOURCE:
        ${config.customResources}
        ---
        `;
    }

    try {
      const prompt = `
        You are an expert curriculum designer. A user wants to learn '${config.skill}'.
        This is the assessment of their current skill level: "${assessment}".
        They can commit '${config.timeCommitment}'.
        ${goalStatement}
        ${frameworkPrompt}
        ${customResourcePrompt}
        Create a structured learning plan. ${concisenessInstruction}
        ${structureInstruction}
        - Each task must have a title and a short, actionable description.
        - For about half of the tasks, provide 1-2 highly relevant, functional online resources from reputable sources (e.g., official documentation, well-known educational platforms, trusted blogs) with a title and a valid URI.
        The response must be a JSON object that strictly adheres to the provided schema.
        IMPORTANT: The "skill" property in the JSON response must contain ONLY the original skill name: '${config.skill}'. Do not add any other descriptive text, summary, or extraneous information to the "skill" property. All curriculum details must be within the "modules" array.
      `;
      const response = await this.genAI!.models.generateContent({
        model: 'gemini-2.5-flash', contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: this.getPlanSchema(config.skill),
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 2048 },
        },
      });
      
      rawResponseText = response.text;
      let jsonText = rawResponseText.trim();

      const match = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonText = match[1];
      }
      
      jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');

      const parsedJson = JSON.parse(jsonText);
      
      if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson) && !Array.isArray(parsedJson.modules)) {
        for (const key in parsedJson) {
          if (Object.prototype.hasOwnProperty.call(parsedJson, key)) {
            const nestedObject = parsedJson[key];
            if (typeof nestedObject === 'object' && nestedObject !== null && Array.isArray(nestedObject.modules)) {
              return nestedObject;
            }
          }
        }
      }

      return parsedJson;

    } catch (e) {
      console.error('Error generating learning plan:', e);
      if (rawResponseText) {
        console.error('Raw AI Response that failed parsing:', rawResponseText);
      }
      this.error.set('Failed to generate the learning plan due to an invalid format from the AI. Please try again.');
      return null;
    }
  }

  async regeneratePlan(plan: LearningPlan, instruction: string, customResources?: string): Promise<Pick<LearningPlan, 'skill' | 'modules'> | null> {
    if (!this.checkConfig()) return null;
    
    this.error.set(null);
    let rawResponseText = '';

    let customResourcePrompt = '';
    if (customResources) {
        customResourcePrompt = `
        The user has provided the following text as an additional resource to guide the regeneration. You should prioritize information from this text when relevant.
        ---
        USER-PROVIDED RESOURCE:
        ${customResources}
        ---
        `;
    }

    try {
      const prompt = `
        You are an expert curriculum designer. A user has an existing learning plan for '${plan.skill}' and wants to modify it based on new instructions.

        HERE IS THE CURRENT PLAN's MODULES (in JSON format):
        ${JSON.stringify(plan.modules)}

        HERE ARE THE USER'S NEW INSTRUCTIONS:
        "${instruction}"

        ${customResourcePrompt}

        Your task is to regenerate the entire 'modules' array for the learning plan.
        IMPORTANT: To ensure the plan fits within the response size, please be concise. Keep all task descriptions to a single, short sentence.
        - You MUST adhere to the original structure (weekly modules, daily tasks).
        - Incorporate the user's instructions into the new plan. For example, if they ask for more practical projects, adjust the daily tasks accordingly. If they want to focus on a sub-topic, re-sequence or add new tasks related to it.
        - The number of weeks can be adjusted if necessary to meet the new instructions.
        - The response must be a JSON object that strictly adheres to the provided schema. It must contain the 'skill' and 'modules' properties.
        - IMPORTANT: The "skill" property in the JSON response must contain ONLY the original skill name: '${plan.skill}'.
      `;
      const response = await this.genAI!.models.generateContent({
        model: 'gemini-2.5-flash', contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: this.getPlanSchema(plan.skill),
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 2048 },
        },
      });
      
      rawResponseText = response.text;
      const parsedJson = JSON.parse(rawResponseText.trim());
      return parsedJson;

    } catch (e) {
      console.error('Error regenerating learning plan:', e);
      if (rawResponseText) {
        console.error('Raw AI Response that failed parsing:', rawResponseText);
      }
      this.error.set('Failed to regenerate the learning plan due to an invalid format from the AI. Please try again.');
      return null;
    }
  }
  
  async convertPlanToFramework(plan: LearningPlan, framework: LearningFramework): Promise<LearningPlan | null> {
      if (!this.checkConfig()) return null;

      const numberOfWeeks = plan.modules.length;
      let goal: Goal;
      if (numberOfWeeks <= 13) {
        goal = '3 Months';
      } else if (numberOfWeeks <= 26) {
        goal = '6 Months';
      } else {
        goal = 'Lifelong';
      }

      const config: PlanConfig = {
          skill: plan.skill,
          timeCommitment: 'about the same as before',
          goal,
          planType: 'time',
          framework: framework
      };
      const newPlanData = await this.generateLearningPlan(config, plan.assessmentSummary);
      if (!newPlanData) return null;
      return { ...plan, modules: newPlanData.modules, framework: framework };
  }

  async generateLevelPreview(skill: string, currentWeek: number): Promise<string> {
      if (!this.checkConfig()) return "API Config missing";
      try {
          const prompt = `A user is learning "${skill}" and has just completed Week ${currentWeek}. Briefly describe, in an exciting and motivational tone, what they will learn in the next two weeks. Focus on the cool projects or key abilities they will unlock.`;
          const response = await this.genAI!.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
          return response.text;
      } catch (e) { return "Could not generate a preview at this time."; }
  }

  async generateQuiz(skill: string, weekTitle: string): Promise<QuizQuestion[]> {
      if (!this.checkConfig()) return [];
      try {
          const prompt = `Generate a 3-question multiple-choice quiz for a user learning "${skill}". The quiz should cover topics from the module titled "${weekTitle}". Ensure the questions test for understanding, not just memorization. The response must be a JSON array of objects with "question", "options" (an array of 4 strings), and "correctAnswer" (the string of the correct option).`;
          const response = await this.genAI!.models.generateContent({
              model: 'gemini-2.5-flash', contents: prompt,
              config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                      type: Type.ARRAY,
                      items: {
                          type: Type.OBJECT, properties: {
                              question: { type: Type.STRING },
                              options: { type: Type.ARRAY, items: { type: Type.STRING } },
                              correctAnswer: { type: Type.STRING }
                          }
                      }
                  }
              }
          });
          return JSON.parse(response.text.trim());
      } catch (e) { return []; }
  }

  async getSkillSuggestions(baseSkill: string): Promise<string[]> {
      if (!this.checkConfig()) return [];
      this.error.set(null);
      try {
          const prompt = `Based on an interest in "${baseSkill}", suggest 5 other related or complementary skills someone might want to learn next. Provide only a JSON array of strings.`;
          const response = await this.genAI!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
              config: {
                  responseMimeType: 'application/json',
                  responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
          });
          return JSON.parse(response.text.trim());
      } catch (e) {
          console.error('Error getting skill suggestions:', e);
          return [];
      }
  }

  async getHolisticSuggestions(plans: LearningPlan[]): Promise<string[]> {
    if (!this.checkConfig()) return [];
    this.error.set(null);
    if (plans.length === 0) return [];
    
    try {
        // Construct a richer user profile for the AI including completion status
        const userProfile = plans.map(p => {
             const allTasks = p.modules.flatMap(m => m.dailyTasks.flatMap(d => d.tasks));
             const completedCount = allTasks.filter(t => t.completed).length;
             const totalCount = allTasks.length;
             const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
             
             return {
                skill: p.skill,
                level: p.assessmentSummary,
                progress: `${progress}% complete`,
                depth: p.modules.length > 8 ? 'In-depth' : 'Standard',
            };
        });

        const prompt = `
        You are an insightful career and skills counselor AI. 
        Here is the user's current learning portfolio with their progress: 
        ${JSON.stringify(userProfile)}
        
        Analyze their interests, current skill levels, and actual progress.
        - If they are nearing completion of a skill (e.g. > 80%), suggest an ADVANCED next step or a specialization.
        - If they are just starting multiple creative skills, suggest something complementary in that domain.
        - Suggest 3 NEW complementary skills.
        - Suggest 2 ADVANCED specializations based on their strongest/most completed skills.
        
        Provide a total of 5 unique, exciting suggestions as a simple JSON array of strings.
        `;
        
        const response = await this.genAI!.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error('Error getting holistic suggestions:', e);
        return [];
    }
  }

  async findResources(skill: string): Promise<Resource[]> {
      if (!this.checkConfig()) return [];
      this.error.set(null);
      try {
          const response = await this.genAI!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: `Find the top 5 most useful articles or video tutorials for a beginner learning ${skill}.`,
              config: {
                  tools: [{ googleSearch: {} }],
              },
          });

          const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[] || [];
          return groundingChunks.map(chunk => chunk.web).filter(resource => resource && resource.uri && resource.title);
      } catch (e) {
          console.error('Error finding resources:', e);
          this.error.set('Failed to find resources. The AI might be busy.');
          return [];
      }
  }
  
  async getSageResponse(history: ChatMessage[], newPrompt: ChatMessage, skill: string): Promise<string> {
      if (!this.checkConfig()) return "I am unable to connect to my brain (API Key missing).";
      this.error.set(null);
      
      const historyForPrompt = history
          .map(m => `${m.role}: ${m.text}`)
          .join('\n');

      try {
          const prompt = `You are 'Skill Sage', an expert on learning ${skill}.
          The user's conversation history is:
          ${historyForPrompt}
          The user's new question is: ${newPrompt.text}
          Provide a helpful and encouraging response. If the user provided an image, audio, or video, analyze it and incorporate your analysis into the response.`;

          const parts: ({ text: string } | { inlineData: { mimeType: string; data: string; } })[] = [{ text: prompt }];

          if (newPrompt.attachment) {
              parts.push({
                  inlineData: {
                      mimeType: newPrompt.attachment.mimeType,
                      data: newPrompt.attachment.data,
                  }
              });
          }

          const response = await this.genAI!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: { parts }
          });
          
          return response.text;
      } catch (e) {
          console.error('Error in chat:', e);
          this.error.set('The Skill Sage is pondering... and ran into an issue. Try again.');
          return "I'm sorry, I couldn't process that. Please try again.";
      }
    }

  async generateSystemResponse(history: ChatMessage[], schedule: UserSchedule | null): Promise<string> {
    if (!this.checkConfig()) return "I cannot build a system without my API Key.";
    this.error.set(null);
    const historyForPrompt = history
        .map(m => `${m.role}: ${m.text}`)
        .join('\n');

    try {
        let scheduleContext = '';
        if (schedule && (schedule.wakeUpTime || schedule.sleepTime || schedule.workSchedule || schedule.existingHabits)) {
        scheduleContext = `
        You have pre-existing information about the user's daily routine. Use this as the primary context for your conversation. Do not ask for this information again unless a specific detail is missing or needs clarification to build a better system.
        User's Schedule:
        - Wakes up around: ${schedule.wakeUpTime || 'Not specified'}
        - Goes to sleep around: ${schedule.sleepTime || 'Not specified'}
        - Work/School Schedule: ${schedule.workSchedule || 'Not specified'}
        - Existing Habits: ${schedule.existingHabits || 'Not specified'}
        `;
        }

        const systemInstruction = `You are an AI Coach specializing in building effective personal systems, based on the principles of James Clear's "Atomic Habits". Your goal is to help a user create a sustainable routine for a new habit or skill.
        ${scheduleContext}
        Your process is as follows:
        1. Acknowledge the user's goal (e.g., "learn to code", "exercise more").
        2. Ask clarifying questions to understand their CURRENT daily routine. You MUST get specifics like:
            - What time do you usually wake up and go to sleep?
            - What is your work/school schedule?
            - What are your existing habits (e.g., "coffee after waking up", "walk the dog in the evening")?
        3. If the user provides vague information, you MUST explicitly ask for the concrete details you need. For example, if they say "I wake up in the morning", ask "What time specifically do you usually wake up?".
        4. Once you have a clear picture of their day (after at least 2-3 user replies), create a simple, actionable system for them.
        5. The system should use "habit stacking": "After [CURRENT HABIT], I will [NEW HABIT]".
        6. Define the frequency (e.g., daily, Mon/Wed/Fri) that seems most appropriate based on their goal and schedule.
        7. Keep the new habit small and achievable (e.g., "write one line of code", "do 5 minutes of stretching").
        8. Present the final system clearly. When you are ready to present the final system, end your response with the special token [[SYSTEM_GENERATED]].
        9. Your tone should be encouraging, practical, and supportive.`;

        const prompt = `Conversation History:
${historyForPrompt}

Based on the history and your instructions, provide the next response in the conversation.`;
        
        const response = await this.genAI!.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
            },
        });
        
        return response.text;
    } catch (e) {
        console.error('Error in systems generator:', e);
        this.error.set('The Systems Coach is thinking... and ran into an issue. Try again.');
        return "I'm sorry, I couldn't process that. Please try again.";
    }
  }
  
  async getHomeSageResponse(history: ChatMessage[], plans: LearningPlan[], newPromptText: string): Promise<string> {
      if (!this.checkConfig()) return "I am currently offline (API Key missing).";
      this.error.set(null);
      
      const historyForPrompt = history
          .map(m => `${m.role}: ${m.text}`)
          .join('\n');

      // Sanitize plans to send only relevant info to the AI to save tokens
      const sanitizedPlans = plans.map(p => ({
          skill: p.skill,
          assessmentSummary: p.assessmentSummary,
          framework: p.framework,
          moduleCount: p.modules.length,
          creationDate: p.creationDate,
      }));

      try {
          const prompt = `
            You are a master learning advisor AI. Your name is Skill Sage.
            You have access to all of the user's learning plans and their current conversation with you.
            Your primary goal is to provide insightful, data-driven advice.
            - Analyze their learning history to suggest new skills that complement what they've already learned.
            - Answer questions about their progress across all plans.
            - Synthesize information about their learning patterns (e.g., "I see you enjoy creative skills...", or "You started learning {skill} on {creationDate}, that's great progress!").
            - Be encouraging and supportive.

            IMPORTANT CONTEXT - USER'S LEARNING HISTORY (JSON):
            ${JSON.stringify(sanitizedPlans, null, 2)}

            CONVERSATION HISTORY:
            ${historyForPrompt}

            Based on ALL the above information, provide a helpful and encouraging response to the user's latest message: "${newPromptText}"
            Do not mention that you are seeing a JSON object. Just use the information naturally in your response.
          `;

          const response = await this.genAI!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
          });
          
          return response.text;
      } catch (e) {
          console.error('Error in home sage chat:', e);
          this.error.set('The Advisor Sage is pondering... and ran into an issue. Try again.');
          return "I'm sorry, I couldn't process that. Please try again.";
      }
    }

  private getPlanSchema(skillName: string) {
    return {
      type: Type.OBJECT,
      properties: {
        skill: { 
          type: Type.STRING,
          description: `The name of the skill. This MUST be exactly: "${skillName}". Do not add any descriptive text or summary.`
        },
        modules: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              week: { type: Type.INTEGER },
              title: { type: Type.STRING },
              dailyTasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    day: { type: Type.INTEGER },
                    tasks: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          description: { type: Type.STRING },
                          completed: { type: Type.BOOLEAN },
                          resources: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                title: { type: Type.STRING },
                                uri: { type: Type.STRING },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }
}
