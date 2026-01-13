
import { Component, ChangeDetectionStrategy, input, output, computed, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LearningPlan } from '../../models';
import { SystemsGeneratorComponent } from '../systems-generator/systems-generator.component';
import { HomeSageComponent } from '../home-sage/home-sage.component';
import { GeminiService } from '../../services/gemini.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  standalone: true,
  imports: [CommonModule, SystemsGeneratorComponent, HomeSageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  plans = input.required<LearningPlan[]>();
  
  startNewSkill = output<void>();
  continueSkill = output<string>();
  deleteSkill = output<string>();

  planPendingDeletion = signal<string | null>(null);
  isSystemsCoachExpanded = signal(false);
  
  private geminiService = inject(GeminiService);
  aiSuggestedSkills = signal<string[]>([]);
  isLoadingSuggestions = signal(false);

  constructor() {
    effect(() => {
        const currentPlans = this.plans();
        if (currentPlans.length > 0) {
            this.loadHolisticSuggestions(currentPlans);
        }
    });
  }

  async loadHolisticSuggestions(plans: LearningPlan[]) {
      this.isLoadingSuggestions.set(true);
      // Fallback first
      const defaultSuggestions = [
        'Mindfulness and Meditation',
        'Basics of Graphic Design',
        'Introduction to Coding',
        'Creative Writing',
        'Personal Finance 101'
      ];
      this.aiSuggestedSkills.set(defaultSuggestions);
      
      // Then try to fetch AI suggestions
      const newSuggestions = await this.geminiService.getHolisticSuggestions(plans);
      if (newSuggestions && newSuggestions.length > 0) {
          this.aiSuggestedSkills.set(newSuggestions);
      }
      this.isLoadingSuggestions.set(false);
  }

  calculateProgress(plan: LearningPlan): number {
    const allTasks = (plan.modules ?? []).flatMap(m => (m.dailyTasks ?? []).flatMap(d => (d.tasks ?? [])));
    if (allTasks.length === 0) return 0;
    const completedTasks = allTasks.filter(t => t.completed).length;
    return Math.round((completedTasks / allTasks.length) * 100);
  }

  onStartNew(): void {
    this.startNewSkill.emit();
  }

  onContinue(planId: string): void {
    if (this.planPendingDeletion() === planId) {
      return;
    }
    if (this.planPendingDeletion() !== null) {
      this.planPendingDeletion.set(null);
    }
    this.continueSkill.emit(planId);
  }

  onDeleteRequest(event: MouseEvent, planId: string): void {
    event.stopPropagation();
    this.planPendingDeletion.set(planId);
  }

  onConfirmDelete(event: MouseEvent, planId: string): void {
    event.stopPropagation();
    this.deleteSkill.emit(planId);
    this.planPendingDeletion.set(null);
  }

  onCancelDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.planPendingDeletion.set(null);
  }

  onSuggestionClick(skill: string): void {
    this.startNewSkill.emit();
  }
}
