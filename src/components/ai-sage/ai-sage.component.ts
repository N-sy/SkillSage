
import { Component, ChangeDetectionStrategy, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessage } from '../../models';
import { GeminiService } from '../../services/gemini.service';

@Component({
  selector: 'app-ai-sage',
  templateUrl: './ai-sage.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSageComponent {
  skill = input.required<string>();
  
  messages = signal<ChatMessage[]>([
    { role: 'model', text: 'Welcome! I am the Skill Sage. Ask me anything about your learning journey. You can also upload an image, audio, or video for analysis.' }
  ]);
  currentMessage = signal('');
  isLoading = signal(false);
  attachment = signal<ChatMessage['attachment'] | null>(null);

  constructor(private geminiService: GeminiService) {}

  async sendMessage(): Promise<void> {
    const userText = this.currentMessage().trim();
    if (!userText && !this.attachment()) return;
    if (this.isLoading()) return;

    const userMessage: ChatMessage = { 
      role: 'user', 
      text: userText,
      ...(this.attachment() && { attachment: this.attachment()! })
    };

    this.messages.update(msgs => [...msgs, userMessage]);
    this.currentMessage.set('');
    this.attachment.set(null);
    this.isLoading.set(true);

    try {
      const response = await this.geminiService.getSageResponse(
        this.messages(),
        userMessage,
        this.skill()
      );
      this.messages.update(msgs => [...msgs, { role: 'model', text: response }]);
    } catch (error) {
      this.messages.update(msgs => [...msgs, { role: 'model', text: 'Sorry, I had trouble thinking of a response. Please try again.' }]);
    } finally {
      this.isLoading.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!file.type.match(/^(image|video|audio)\//)) {
        alert('Please select an image, video, or audio file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        this.attachment.set({
            name: file.name,
            mimeType: file.type,
            data: (reader.result as string).split(',')[1] 
        });
    };
    reader.readAsDataURL(file);
    // Clear the input value to allow selecting the same file again
    input.value = '';
  }

  removeAttachment(): void {
      this.attachment.set(null);
  }
}
