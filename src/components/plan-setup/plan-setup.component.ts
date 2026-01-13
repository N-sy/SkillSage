
import { Component, ChangeDetectionStrategy, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlanConfig, Goal, LearningFramework, PlanType } from '../../models';

@Component({
  selector: 'app-plan-setup',
  templateUrl: './plan-setup.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanSetupComponent {
  skill = input.required<string>();
  planConfigured = output<Omit<PlanConfig, 'skill'>>();

  daysPerWeek = signal(5);
  hoursPerSession = signal('1 hour');
  selectedPlanType = signal<PlanType>('time');
  selectedGoal = signal<Goal | 'Custom'>('3 Months');
  customGoalText = signal('');
  purposeText = signal('');
  selectedFramework = signal<LearningFramework>('standard');
  customResourceText = signal<string | null>(null);
  customResourceFileName = signal<string | null>(null);

  daysOptions = [1, 2, 3, 4, 5, 6, 7];
  goals: (Goal | 'Custom')[] = ['3 Months', '6 Months', 'Lifelong', 'Custom'];
  frameworks: { id: LearningFramework; name: string; description: string }[] = [
    { id: 'standard', name: 'Standard Plan', description: 'A balanced, week-by-week curriculum.' },
    { id: 'disss', name: 'DiSSS/CaFE Framework', description: 'An accelerated plan focused on the most critical components.' },
  ];

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    
    if (!file.type.startsWith('text/plain')) {
        alert('Please upload a plain text file (.txt). Support for other formats is coming soon.');
        input.value = ''; // Reset input
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        this.customResourceText.set(reader.result as string);
        this.customResourceFileName.set(file.name);
    };
    reader.onerror = () => {
        alert('Error reading file.');
        this.removeCustomResource();
    };
    reader.readAsText(file);
    input.value = '';
  }

  removeCustomResource(): void {
      this.customResourceText.set(null);
      this.customResourceFileName.set(null);
  }

  startAssessment() {
    let goalValue: string | undefined;
    if (this.selectedPlanType() === 'time') {
      goalValue = this.selectedGoal() === 'Custom' ? this.customGoalText() : this.selectedGoal();
    }

    const timeCommitment = `${this.daysPerWeek()} day${this.daysPerWeek() > 1 ? 's' : ''} per week, for about ${this.hoursPerSession()} each session.`;

    const config: Omit<PlanConfig, 'skill'> = {
      timeCommitment: timeCommitment,
      framework: this.selectedFramework(),
      planType: this.selectedPlanType(),
      ...(this.selectedPlanType() === 'time' && { goal: goalValue }),
      ...(this.selectedPlanType() === 'purpose' && { purpose: this.purposeText() }),
      ...(this.customResourceText() && { customResources: this.customResourceText()! }),
    };
    this.planConfigured.emit(config);
  }
}