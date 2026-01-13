
import { Component, ChangeDetectionStrategy, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-skill-selection',
  templateUrl: './skill-selection.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillSelectionComponent {
  skillSelected = output<string>();
  customSkill = signal('');

  predefinedSkills = [
    'Angular Development',
    'Public Speaking',
    'Data Science with Python',
    'Financial Literacy',
    'Digital Marketing',
    'Learn to Play Guitar',
  ];

  selectSkill(skill: string) {
    if (skill && skill.trim()) {
      this.skillSelected.emit(skill.trim());
    }
  }

  submitCustomSkill() {
    this.selectSkill(this.customSkill());
  }
}
