

export type AppState = 'home' | 'selection' | 'setup' | 'assessment' | 'generating' | 'dashboard';
export type LearningFramework = 'standard' | 'disss';
export type Goal = '3 Months' | '6 Months' | 'Lifelong';
export type PlanType = 'time' | 'purpose';

export interface PlanConfig {
  skill: string;
  timeCommitment: string;
  planType: PlanType;
  goal?: string;
  purpose?: string;
  framework: LearningFramework;
  customResources?: string;
}

export interface Resource {
  title: string;
  uri: string;
}

export interface LearningTask {
  title:string;
  description: string;
  completed: boolean;
  resources?: Resource[];
}

export interface DailyTaskGroup {
  day: number;
  tasks: LearningTask[];
}

export interface LearningModule {
  week: number;
  title: string;
  dailyTasks: DailyTaskGroup[];
}

export interface LearningPlan {
  id: string; 
  creationDate: string; // ISO String
  skill: string;
  modules: LearningModule[];
  suggestedSkills: string[];
  framework: LearningFramework;
  assessmentSummary: string;
  dailyLogs?: DailyLog[];
}

export interface GroundingChunk {
  web: Resource;
}

export interface DailyLog {
  id: string;
  date: string; // ISO String
  notes: string;
  attachment?: {
    mimeType: string;
    data: string; // base64
    name: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  attachment?: {
      mimeType: string;
      data: string;
      name: string;
  }
}

export interface AssessmentMessage {
    role: 'user' | 'model';
    text: string;
    attachment?: {
        mimeType: string;
        data: string; // base64 encoded string
        name: string;
    }
}

export interface QuizQuestion {
    question: string;
    options: string[];
    correctAnswer: string;
}

export interface UserSchedule {
  wakeUpTime: string;
  sleepTime: string;
  workSchedule: string;
  existingHabits: string;
}

export interface SkillSuggestion {
  skill: string;
  reason: string;
  category: string;
}
