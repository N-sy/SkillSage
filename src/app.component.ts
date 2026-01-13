
import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppState, PlanConfig, LearningPlan, AssessmentMessage } from './models';
import { GeminiService } from './services/gemini.service';
import { PersistenceService } from './services/persistence.service';
import { AuthService } from './services/auth.service';

import { HomeComponent } from './components/home/home.component';
import { SkillSelectionComponent } from './components/skill-selection/skill-selection.component';
import { PlanSetupComponent } from './components/plan-setup/plan-setup.component';
import { LearningDashboardComponent } from './components/learning-dashboard/learning-dashboard.component';
import { SkillAssessmentComponent } from './components/skill-assessment/skill-assessment.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: true,
  imports: [
    CommonModule,
    HomeComponent,
    SkillSelectionComponent,
    PlanSetupComponent,
    LearningDashboardComponent,
    SkillAssessmentComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  appState = signal<AppState>('home');
  currentPlan = signal<LearningPlan | null>(null);
  planConfig = signal<Partial<PlanConfig>>({});
  
  // Controls the visibility of the "Preview Mode" auth helper info
  showAuthHelp = signal(false);
  
  assessmentConfig = computed(() => {
    // This computed signal is only used when appState is 'assessment',
    // at which point planConfig will have all required properties.
    return this.planConfig() as PlanConfig;
  });

  public geminiService = inject(GeminiService);
  persistenceService = inject(PersistenceService);
  authService = inject(AuthService);

  onStartNewSkill(): void {
    this.appState.set('selection');
  }

  onContinueSkill(planId: string): void {
    const plan = this.persistenceService.getPlan(planId);
    if (plan) {
      this.currentPlan.set(plan);
      this.appState.set('dashboard');
    }
  }

  onDeleteSkill(planId: string): void {
    this.persistenceService.deletePlan(planId);
  }

  onSkillSelect(skill: string): void {
    this.planConfig.set({ skill });
    this.appState.set('setup');
  }

  onPlanConfigured(config: Omit<PlanConfig, 'skill'>): void {
    this.planConfig.update(c => ({...c, ...config}));
    this.appState.set('assessment');
  }
  
  async onAssessmentComplete({ summary }: { summary: string }): Promise<void> {
    // Capture the config at the start of generation to prevent issues if user navigates away
    const finalConfig = this.planConfig() as PlanConfig;
    this.appState.set('generating');
    
    let planData = await this.geminiService.generateLearningPlan(finalConfig, summary);
    
    // Validate the response from the AI. We primarily care that we received a modules array.
    if (planData && !Array.isArray(planData.modules)) {
        console.error('Received malformed plan data from AI (modules is not an array). Discarding.', planData);
        planData = null; // Invalidate the data to trigger the error path.
    }
    
    if (planData) {
      // The AI might return a modified skill title. We'll ignore it and use our original skill name for consistency.
      const suggestions = await this.geminiService.getSkillSuggestions(finalConfig.skill);
      const id = new Date().toISOString();
      const newPlan: LearningPlan = {
        ...planData,
        skill: finalConfig.skill, // Explicitly use the user-defined skill name
        id: id,
        creationDate: id,
        suggestedSkills: suggestions,
        framework: finalConfig.framework,
        assessmentSummary: summary,
      };
      this.persistenceService.savePlan(newPlan);
      
      // Successfully generated. Even if user went home, redirecting to dashboard
      // confirms the plan is ready and contextually makes sense as a notification.
      this.currentPlan.set(newPlan);
      this.appState.set('dashboard');
    } else {
      // If generation failed, only interrupt if the user is still on the waiting screen.
      // If they went home, just log it to console to avoid random alert interruptions.
      if (this.appState() === 'generating') {
        alert('Could not generate a plan. Please check your connection or try different options.');
        this.appState.set('setup');
      } else {
        console.error('Background generation failed.');
      }
    }
  }

  onGoHome(): void {
    // Note: Clearing planConfig here does not stop the async generation in onAssessmentComplete
    // because that method captures the config object before the await.
    this.planConfig.set({});
    this.currentPlan.set(null);
    this.appState.set('home');
  }
}
