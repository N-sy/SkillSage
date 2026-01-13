
import { Component, ChangeDetectionStrategy, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessage, LearningPlan } from '../../models';
import { GeminiService } from '../../services/gemini.service';

@Component({
  selector: 'app-home-sage',
  templateUrl: './home-sage.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeSageComponent {
  plans = input.required<LearningPlan[]>();
  
  messages = signal<ChatMessage[]>([
    { role: 'model', text: 'Welcome! I am your learning advisor. Ask me about your progress, or for recommendations on what to learn next based on your journey so far.' }
  ]);
  currentMessage = signal('');
  isLoading = signal(false);

  constructor(private geminiService: GeminiService) {}

  async sendMessage(): Promise<void> {
    const userText = this.currentMessage().trim();
    if (!userText || this.isLoading()) return;

    const userMessage: ChatMessage = { role: 'user', text: userText };

    this.messages.update(msgs => [...msgs, userMessage]);
    this.currentMessage.set('');
    this.isLoading.set(true);

    try {
      const response = await this.geminiService.getHomeSageResponse(
        this.messages(),
        this.plans(),
        userText
      );
      this.messages.update(msgs => [...msgs, { role: 'model', text: response }]);
    } catch (error) {
      this.messages.update(msgs => [...msgs, { role: 'model', text: 'Sorry, I had trouble thinking of a response. Please try again.' }]);
    } finally {
      this.isLoading.set(false);
    }
  }
}
