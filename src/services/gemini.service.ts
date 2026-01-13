import { Injectable, signal } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';
import { PlanConfig, LearningPlan, ChatMessage, GroundingChunk, Resource, LearningFramework, AssessmentMessage, QuizQuestion, Goal, UserSchedule, SkillSuggestion } from '../models';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private ai: GoogleGenAI | undefined;
  public error = signal<string | null>(null);

  constructor() {
    // Process.env.API_KEY is populated by Vite's define plugin
    const apiKey = process.env.API_KEY;
    
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey: apiKey });
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
      if (!this.ai) {
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
          IMPORTANT CONTEXT: The user has specified a custom learning timeframe of "${config.goal}". If this is unrealistic, politely question it.
          `;
        }

        const basePrompt = `You are an expert skills assessor. Your goal is to determine a user's proficiency in "${config.skill}".
        ${timelineContext}
        
        Conversation History:
        ${history.map(m => `${m.role}: ${m.text}`).join('\n')}

        Task:
        1. If you have enough info (after ~2 interactions), summarize their level in one sentence and append '[[ASSESSMENT_COMPLETE]]'.
        2. Otherwise, ask ONE clear follow-up question.`;

        const parts: any[] = []; // Using any to simplify the strict typing of the Union

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

        const response = await this.ai!.models.generateContent({
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
        frameworkPrompt = `Use the DiSSS (Deconstruction, Selection, Sequencing, Stakes) framework.`;
    }

    const isLongTerm = this.isLongTermGoal(config.goal) || config.planType === 'purpose';
    const concisenessInstruction = isLongTerm ? 'Keep task descriptions to one short sentence.' : '';

    try {
      const prompt = `
        Act as an expert curriculum designer.
        Skill: '${config.skill}'.
        Level: "${assessment}".
        Commitment: '${config.timeCommitment}'.
        ${config.planType === 'purpose' ? `Purpose: "${config.purpose}"` : `Goal: "${config.goal}"`}
        ${frameworkPrompt}
        ${config.customResources ? `User Context: ${config.customResources}` : ''}
        
        Create a structured learning plan in JSON.
        ${concisenessInstruction}
        - Detailed weekly modules with daily tasks.
        - Include real, high-quality URL resources for ~50% of tasks.
        
        IMPORTANT: The "skill" property in JSON must be EXACTLY: '${config.skill}'.
      `;
      
      const response = await this.ai!.models.generateContent({
        model: 'gemini-2.5-flash', 
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: this.getPlanSchema(config.skill),
            maxOutputTokens: 16384, // High limit for long plans
            thinkingConfig: { thinkingBudget: 2048 }, // Reserve tokens for thinking
        },
      });
      
      rawResponseText = response.text;
      const parsedJson = JSON.parse(rawResponseText.trim());
      
      // Handle potential nesting issues if the model wraps it unnecessarily
      if (parsedJson && !Array.isArray(parsedJson) && !parsedJson.modules) {
          // Attempt to find the modules array in nested keys
          for (const key of Object.keys(parsedJson)) {
              if (parsedJson[key]?.modules) return parsedJson[key];
          }
      }

      return parsedJson;

    } catch (e) {
      console.error('Error generating learning plan:', e);
      this.error.set('Failed to generate the learning plan. Please try again.');
      return null;
    }
  }

  async regeneratePlan(plan: LearningPlan, instruction: string, customResources?: string): Promise<Pick<LearningPlan, 'skill' | 'modules'> | null> {
    if (!this.checkConfig()) return null;
    this.error.set(null);

    try {
      const prompt = `
        Regenerate this learning plan for '${plan.skill}'.
        Current Modules: ${JSON.stringify(plan.modules)}
        User Instruction: "${instruction}"
        ${customResources ? `Context: ${customResources}` : ''}
        
        Keep the structure (weekly modules, daily tasks).
        Return JSON matching the schema.
      `;
      
      const response = await this.ai!.models.generateContent({
        model: 'gemini-2.5-flash', 
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: this.getPlanSchema(plan.skill),
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 2048 },
        },
      });
      
      return JSON.parse(response.text.trim());
    } catch (e) {
      console.error('Error regenerating plan:', e);
      this.error.set('Failed to regenerate plan.');
      return null;
    }
  }
  
  async convertPlanToFramework(plan: LearningPlan, framework: LearningFramework): Promise<LearningPlan | null> {
      if (!this.checkConfig()) return null;
      // Re-generate using the existing assessment but new framework flag
      const config: PlanConfig = {
          skill: plan.skill,
          timeCommitment: 'same as before',
          goal: '3 Months', // Defaulting for conversion context
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
          const prompt = `Describe what a student learning "${skill}" will achieve in Week ${currentWeek + 1} and ${currentWeek + 2}. Be exciting!`;
          const response = await this.ai!.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
          return response.text;
      } catch (e) { return "Preview unavailable."; }
  }

  async generateQuiz(skill: string, weekTitle: string): Promise<QuizQuestion[]> {
      if (!this.checkConfig()) return [];
      try {
          const prompt = `Create a 3-question multiple-choice quiz for "${skill}" (Topic: ${weekTitle}). JSON format.`;
          const response = await this.ai!.models.generateContent({
              model: 'gemini-2.5-flash', 
              contents: prompt,
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
      try {
          const prompt = `Suggest 5 skills related to "${baseSkill}". Return JSON string array.`;
          const response = await this.ai!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
              config: {
                  responseMimeType: 'application/json',
                  responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
          });
          return JSON.parse(response.text.trim());
      } catch (e) { return []; }
  }

  // --- FEATURE: Recommend skills based on record ---
  async getHolisticSuggestions(plans: LearningPlan[], currentInterests: string = ''): Promise<SkillSuggestion[]> {
    if (!this.checkConfig()) return [];
    this.error.set(null);
    
    try {
        const userProfile = plans.map(p => {
             const allTasks = p.modules.flatMap(m => m.dailyTasks.flatMap(d => d.tasks));
             const completedCount = allTasks.filter(t => t.completed).length;
             const progress = allTasks.length > 0 ? Math.round((completedCount / allTasks.length) * 100) : 0;
             return { skill: p.skill, progress: `${progress}%` };
        });

        const prompt = `
        You are a career counselor.
        User's Learning Record: ${JSON.stringify(userProfile)}
        Current Interests: "${currentInterests}"
        
        Recommend 6 new skills.
        - If they finished a skill, suggest advanced topics.
        - If they are beginners, suggest complementary skills.
        - Explain WHY for each.
        
        Return JSON array: { skill, reason, category }.
        `;
        
        const response = await this.ai!.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                      type: Type.OBJECT, properties: {
                          skill: { type: Type.STRING },
                          reason: { type: Type.STRING },
                          category: { type: Type.STRING }
                      }
                  }
              }
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
      try {
          const response = await this.ai!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: `Find 5 top tutorials for learning ${skill}.`,
              config: { tools: [{ googleSearch: {} }] },
          });

          const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[] || [];
          return chunks.map(c => c.web).filter(r => r && r.uri && r.title);
      } catch (e) { return []; }
  }
  
  async getSageResponse(history: ChatMessage[], newPrompt: ChatMessage, skill: string): Promise<string> {
      if (!this.checkConfig()) return "API Key missing.";
      this.error.set(null);
      
      try {
          const historyText = history.map(m => `${m.role}: ${m.text}`).join('\n');
          const prompt = `Act as 'Skill Sage', an expert on ${skill}.\nHistory:\n${historyText}\nUser: ${newPrompt.text}`;

          const parts: any[] = [{ text: prompt }];
          if (newPrompt.attachment) {
              parts.push({
                  inlineData: {
                      mimeType: newPrompt.attachment.mimeType,
                      data: newPrompt.attachment.data,
                  }
              });
          }

          const response = await this.ai!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: { parts }
          });
          
          return response.text;
      } catch (e) {
          console.error('Sage error:', e);
          return "I'm having trouble thinking right now. Try again.";
      }
    }

  async generateSystemResponse(history: ChatMessage[], schedule: UserSchedule | null): Promise<string> {
    if (!this.checkConfig()) return "API Key missing.";
    this.error.set(null);

    try {
        const scheduleContext = schedule ? `User Schedule: Wake ${schedule.wakeUpTime}, Sleep ${schedule.sleepTime}, Work ${schedule.workSchedule}, Habits ${schedule.existingHabits}` : '';
        const systemInstruction = `You are an Atomic Habits coach. Help the user build a routine. ${scheduleContext}. Use habit stacking. Be practical.`;
        
        const historyText = history.map(m => `${m.role}: ${m.text}`).join('\n');
        const response = await this.ai!.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `History:\n${historyText}\nRespond as the coach.`,
            config: { systemInstruction },
        });
        
        return response.text;
    } catch (e) { return "I can't build a system right now."; }
  }
  
  async getHomeSageResponse(history: ChatMessage[], plans: LearningPlan[], newPromptText: string): Promise<string> {
      if (!this.checkConfig()) return "API Key missing.";
      this.error.set(null);
      
      try {
          const summary = plans.map(p => ({ skill: p.skill, level: p.assessmentSummary }));
          const prompt = `
            You are Skill Sage, a learning advisor.
            User Plans: ${JSON.stringify(summary)}
            History: ${history.map(m => `${m.role}: ${m.text}`).join('\n')}
            User: "${newPromptText}"
            Provide encouraging advice.
          `;

          const response = await this.ai!.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: prompt,
          });
          
          return response.text;
      } catch (e) { return "I'm offline right now."; }
    }

  private getPlanSchema(skillName: string) {
    return {
      type: Type.OBJECT,
      properties: {
        skill: { type: Type.STRING, description: `Must be exactly "${skillName}"` },
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