
import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessage, UserSchedule } from '../../models';
import { GeminiService } from '../../services/gemini.service';
import { PersistenceService } from '../../services/persistence.service';

@Component({
  selector: 'app-systems-generator',
  templateUrl: './systems-generator.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemsGeneratorComponent {
  private geminiService = inject(GeminiService);
  private persistenceService = inject(PersistenceService);

  messages = signal<ChatMessage[]>([
    { role: 'model', text: "Hello! I'm an AI coach trained on the principles of Atomic Habits. What new skill or habit would you like to build a system for?" }
  ]);
  currentMessage = signal('');
  isLoading = signal(false);
  isComplete = signal(false);
  
  viewState = signal<'chat' | 'schedule'>('chat');
  scheduleForm = signal<UserSchedule>({
    wakeUpTime: '', sleepTime: '', workSchedule: '', existingHabits: ''
  });

  // Voice input state
  isListening = signal(false);
  transcriptPreview = signal<string | null>(null);
  private recognition: any;

  constructor() {
    const storedSchedule = this.persistenceService.userSchedule();
    if (storedSchedule) {
        this.scheduleForm.set(storedSchedule);
    }
  }

  async sendMessage(): Promise<void> {
    const userText = this.currentMessage().trim();
    if (!userText || this.isLoading()) return;

    const userMessage: ChatMessage = { role: 'user', text: userText };
    this.messages.update(msgs => [...msgs, userMessage]);
    this.currentMessage.set('');
    this.isLoading.set(true);

    try {
      const response = await this.geminiService.generateSystemResponse(this.messages(), this.persistenceService.userSchedule());
      
      if (response.includes('[[SYSTEM_GENERATED]]')) {
        const cleanResponse = response.replace('[[SYSTEM_GENERATED]]', '').trim();
        this.messages.update(msgs => [...msgs, { role: 'model', text: cleanResponse }]);
        this.isComplete.set(true);
      } else {
        this.messages.update(msgs => [...msgs, { role: 'model', text: response }]);
      }

    } catch (error) {
      this.messages.update(msgs => [...msgs, { role: 'model', text: 'Sorry, I had trouble thinking of a response. Please try again.' }]);
    } finally {
      this.isLoading.set(false);
    }
  }

  startVoiceInput(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Your browser does not support Speech Recognition. Please use Chrome or Edge.');
      return;
    }

    if (this.isListening() || this.transcriptPreview()) return;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.lang = 'en-US';
    this.recognition.interimResults = false;

    this.recognition.onstart = () => this.isListening.set(true);
    this.recognition.onend = () => this.isListening.set(false);

    this.recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        this.transcriptPreview.set(transcript);
      }
    };
    
    this.recognition.onerror = (event: any) => {
      console.warn('Speech recognition error', event.error);
      this.isListening.set(false);
    };

    try {
      this.recognition.start();
    } catch(e) {
      console.error("Could not start speech recognition", e);
      this.isListening.set(false);
    }
  }

  confirmVoiceInput(): void {
    if (this.transcriptPreview()) {
      this.currentMessage.set(this.transcriptPreview()!);
      this.transcriptPreview.set(null);
    }
  }

  cancelVoiceInput(): void {
    this.transcriptPreview.set(null);
  }

  resetConversation(): void {
    this.isComplete.set(false);
    this.isLoading.set(false);
    if(this.recognition) {
      this.recognition.abort();
    }
    this.isListening.set(false);
    this.transcriptPreview.set(null);
    this.messages.set([
      { role: 'model', text: "Of course! What other skill or habit can I help you build a system for?" }
    ]);
  }

  editSchedule(): void {
    const storedSchedule = this.persistenceService.userSchedule();
    this.scheduleForm.set(storedSchedule ?? { wakeUpTime: '', sleepTime: '', workSchedule: '', existingHabits: '' });
    this.viewState.set('schedule');
  }

  saveSchedule(): void {
    this.persistenceService.saveSchedule(this.scheduleForm());
    this.viewState.set('chat');
    this.messages.update(msgs => [...msgs, {role: 'model', text: 'Great! I\'ve saved your schedule. I\'ll use this to help build your systems.'}]);
  }

  cancelEditSchedule(): void {
    this.viewState.set('chat');
  }

  clearSchedule(): void {
    if (confirm('Are you sure you want to delete all your schedule information? This cannot be undone.')) {
        this.persistenceService.clearSchedule();
        this.scheduleForm.set({ wakeUpTime: '', sleepTime: '', workSchedule: '', existingHabits: '' });
    }
  }
}