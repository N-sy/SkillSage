
import { Component, ChangeDetectionStrategy, input, effect, signal, WritableSignal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LearningPlan, DailyLog, Resource, QuizQuestion } from '../../models';
import { GeminiService } from '../../services/gemini.service';
import { PersistenceService } from '../../services/persistence.service';
import { AiSageComponent } from '../ai-sage/ai-sage.component';

@Component({
  selector: 'app-learning-dashboard',
  templateUrl: './learning-dashboard.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule, AiSageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LearningDashboardComponent {
  learningPlan = input.required<LearningPlan>();
  
  private geminiService = inject(GeminiService);
  private persistenceService = inject(PersistenceService);

  planState: WritableSignal<LearningPlan | null> = signal(null);
  
  currentLogNote = signal('');
  logAttachment = signal<DailyLog['attachment'] | null>(null);
  streak = signal(0); // This could be enhanced to be calculated from logs
  
  resources = signal<Resource[]>([]);
  isLoadingResources = signal(false);
  activeModule = signal(0);
  activeTab = signal<'plan' | 'log' | 'resources' | 'sage' | 'adapt'>('plan');
  
  isConverting = signal(false);
  levelPreview = signal<string | null>(null);
  quiz = signal<QuizQuestion[] | null>(null);
  quizAnswers = signal<{ [key: number]: string }>({});
  quizScore = signal<number | null>(null);

  logGrouping = signal<'day' | 'week' | 'month' | 'year'>('day');

  isRegenerating = signal(false);
  regenerationInstruction = signal('');
  regenerationResourceText = signal<string | null>(null);
  regenerationResourceFileName = signal<string | null>(null);

  allResources = computed(() => {
    const generalResources = this.resources();
    const taskResources = this.planState()?.modules
        .flatMap(m => m.dailyTasks.flatMap(d => d.tasks))
        .flatMap(t => t.resources ?? []) ?? [];
    
    const combined = [...generalResources, ...taskResources];
    const unique = Array.from(new Map(combined.map(item => [item.uri, item])).values());
    return unique;
  });

  isLongTermPlan = computed(() => {
    const plan = this.planState();
    if (!plan) return false;
    // A plan is long-term if it has more than 12 weeks OR if any module after the 4th has a title that doesn't start with "Week".
    if ((plan.modules?.length ?? 0) > 12) return true;
    return plan.modules?.slice(4).some(m => !m.title.toLowerCase().startsWith('week'));
  });

  groupedLogs = computed(() => {
    const grouping = this.logGrouping();
    const logs = this.planState()?.dailyLogs ?? [];
    if (!logs.length) return {};

    const sortedLogs = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return sortedLogs.reduce((acc, log) => {
        const date = new Date(log.date);
        let key = '';

        switch(grouping) {
            case 'year':
                key = `${date.getFullYear()}`;
                break;
            case 'month':
                key = date.toLocaleString('default', { month: 'long', year: 'numeric' });
                break;
            case 'week':
                const startOfWeek = new Date(date);
                startOfWeek.setDate(date.getDate() - date.getDay());
                key = `Week of ${startOfWeek.toLocaleDateString()}`;
                break;
            case 'day':
                key = date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                break;
        }

        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(log);
        return acc;
    }, {} as { [key: string]: DailyLog[] });
  });
  
  groupedLogsKeys = computed(() => Object.keys(this.groupedLogs()));

  constructor() {
    effect(() => {
      const plan = this.learningPlan();
      // Ensure dailyLogs array exists for backwards compatibility
      plan.dailyLogs = plan.dailyLogs ?? [];
      this.planState.set(JSON.parse(JSON.stringify(plan)));
      this.fetchResources();
    });
  }

  fetchResources(): void {
    this.isLoadingResources.set(true);
    this.geminiService.findResources(this.learningPlan().skill)
      .then(res => this.resources.set(res))
      .finally(() => this.isLoadingResources.set(false));
  }
  
  toggleTask(moduleIndex: number, dayIndex: number, taskIndex: number): void {
    this.planState.update(plan => {
      if (plan) {
        const task = plan.modules?.[moduleIndex]?.dailyTasks?.[dayIndex]?.tasks?.[taskIndex];
        if (task) {
            task.completed = !task.completed;
            this.persistenceService.savePlan(plan);
        }
      }
      return plan;
    });
  }

  addLog(): void {
    const notes = this.currentLogNote().trim();
    if (!notes && !this.logAttachment()) return;

    this.planState.update(plan => {
      if (plan) {
        const newLog: DailyLog = {
          id: new Date().toISOString() + Math.random(),
          date: new Date().toISOString(),
          notes: notes,
          ...(this.logAttachment() && { attachment: this.logAttachment()! })
        };
        plan.dailyLogs = [newLog, ...(plan.dailyLogs ?? [])];
        this.persistenceService.savePlan(plan);
      }
      return plan;
    });
    
    this.currentLogNote.set('');
    this.logAttachment.set(null);
  }
  
  onLogFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    if (!file.type.match(/^(image|video|audio)\//)) {
      alert('Please select an image, video, or audio file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.logAttachment.set({
        name: file.name,
        mimeType: file.type,
        data: (reader.result as string).split(',')[1] 
      });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  removeLogAttachment(): void {
    this.logAttachment.set(null);
  }


  async convertPlan(): Promise<void> {
    const plan = this.planState();
    if (!plan || plan.framework === 'disss') return;
    this.isConverting.set(true);
    const newPlan = await this.geminiService.convertPlanToFramework(plan, 'disss');
    if (newPlan) {
      this.planState.set(newPlan);
      this.persistenceService.savePlan(newPlan);
    }
    this.isConverting.set(false);
  }

  onRegenFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!file.type.startsWith('text/plain')) {
        alert('Please upload a plain text file (.txt).');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        this.regenerationResourceText.set(reader.result as string);
        this.regenerationResourceFileName.set(file.name);
    };
    reader.onerror = () => {
        alert('Error reading file.');
        this.removeRegenResource();
    };
    reader.readAsText(file);
    input.value = '';
  }

  removeRegenResource(): void {
      this.regenerationResourceText.set(null);
      this.regenerationResourceFileName.set(null);
  }

  async regeneratePlan(): Promise<void> {
    const plan = this.planState();
    const instruction = this.regenerationInstruction().trim();
    if (!plan || !instruction) return;
    
    this.isRegenerating.set(true);
    const newPlanData = await this.geminiService.regeneratePlan(plan, instruction, this.regenerationResourceText() ?? undefined);
    this.isRegenerating.set(false);

    if (newPlanData) {
      this.planState.update(currentPlan => {
        if (currentPlan) {
          const updatedPlan = { ...currentPlan, modules: newPlanData.modules };
          this.persistenceService.savePlan(updatedPlan);
          return updatedPlan;
        }
        return currentPlan;
      });
      this.regenerationInstruction.set('');
      this.regenerationResourceText.set(null);
      this.regenerationResourceFileName.set(null);
      this.activeTab.set('plan');
      alert('Your plan has been regenerated successfully!');
    } else {
      alert('There was an error regenerating your plan. Please try again.');
    }
  }
  
  async showLevelPreview(): Promise<void> {
    const plan = this.planState();
    if (!plan) return;
    this.levelPreview.set('Generating preview...');
    const preview = await this.geminiService.generateLevelPreview(plan.skill, this.activeModule() + 1);
    this.levelPreview.set(preview);
  }
  
  async generateQuiz(): Promise<void> {
    const plan = this.planState();
    if (!plan) return;
    const currentModule = plan.modules?.[this.activeModule()];
    if (!currentModule) {
      console.error("Cannot generate quiz for a module that doesn't exist.");
      return;
    }
    this.quizScore.set(null);
    this.quizAnswers.set({});
    this.quiz.set([]);
    const questions = await this.geminiService.generateQuiz(plan.skill, currentModule.title);
    this.quiz.set(questions);
  }
  
  selectAnswer(questionIndex: number, answer: string): void {
    this.quizAnswers.update(answers => ({ ...answers, [questionIndex]: answer }));
  }

  submitQuiz(): void {
    const currentQuiz = this.quiz();
    if (!currentQuiz) return;
    let score = 0;
    currentQuiz.forEach((q, index) => {
      if (this.quizAnswers()[index] === q.correctAnswer) {
        score++;
      }
    });
    this.quizScore.set((score / currentQuiz.length) * 100);
  }

  getLogTime(dateString: string): string {
    return new Date(dateString).toLocaleTimeString();
  }

  get progress(): number {
    const plan = this.planState();
    if (!plan) return 0;
    const allTasks = (plan.modules ?? []).flatMap(m => (m.dailyTasks ?? []).flatMap(d => (d.tasks ?? [])));
    if (allTasks.length === 0) return 0;
    const completedTasks = allTasks.filter(t => t.completed).length;
    return Math.round((completedTasks / allTasks.length) * 100);
  }
}