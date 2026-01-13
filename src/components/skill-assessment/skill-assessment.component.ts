
import { Component, ChangeDetectionStrategy, input, output, signal, afterNextRender, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssessmentMessage, PlanConfig } from '../../models';
import { GeminiService } from '../../services/gemini.service';

// Type definition for Web Speech API
declare var webkitSpeechRecognition: any;
declare var SpeechRecognition: any;

@Component({
  selector: 'app-skill-assessment',
  templateUrl: './skill-assessment.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillAssessmentComponent implements OnDestroy {
  config = input.required<PlanConfig>();
  assessmentComplete = output<{ summary: string; conversation: AssessmentMessage[] }>();

  conversation = signal<AssessmentMessage[]>([]);
  userResponse = signal('');
  isAssessing = signal(false);
  attachment = signal<AssessmentMessage['attachment'] | null>(null);

  // Voice transcription state
  isTranscribing = signal(false);
  private transcriptionRecognition: any;

  // Live Talk State
  isLiveMode = signal(false);
  isListening = signal(false);
  isSpeaking = signal(false);
  private recognition: any;
  private synth = window.speechSynthesis;

  constructor(private geminiService: GeminiService) {
    afterNextRender(() => {
      this.startAssessment();
    });
  }

  ngOnDestroy() {
    if (this.transcriptionRecognition) {
        this.transcriptionRecognition.abort();
    }
    this.stopLiveMode();
  }

  async startAssessment(): Promise<void> {
    this.isAssessing.set(true);
    const initialText = `Let's figure out your current level in ${this.config().skill}. What's your experience so far? You can describe it, upload an image, or use the mic to transcribe your voice.`;
    
    const initialMessages: AssessmentMessage[] = [
      { role: 'model', text: initialText }
    ];
    this.conversation.set(initialMessages);
    this.isAssessing.set(false);
  }

  // --- Live Talk Logic ---

  toggleLiveMode(): void {
    if (this.isLiveMode()) {
      this.stopLiveMode();
    } else {
      this.startLiveMode();
    }
  }

  startLiveMode(): void {
    const SpeechRecognitionImpl = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      alert('Your browser does not support Live Speech Recognition. Please use Chrome or Edge.');
      return;
    }

    this.isLiveMode.set(true);
    this.recognition = new SpeechRecognitionImpl();
    this.recognition.continuous = false; // Stop after one sentence/phrase
    this.recognition.lang = 'en-US';
    this.recognition.interimResults = false;

    this.recognition.onstart = () => {
      this.isListening.set(true);
    };

    this.recognition.onend = () => {
      this.isListening.set(false);
    };

    this.recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        const trimmedTranscript = transcript.trim();
        if (trimmedTranscript) {
          this.userResponse.set(trimmedTranscript);
          this.submitResponse();
        }
      }
    };
    
    this.recognition.onerror = (event: any) => {
      console.warn('Speech recognition error', event.error);
      this.isListening.set(false);
    };

    try {
      this.recognition.start();
    } catch (e) {
      console.error('Failed to start recognition', e);
    }
  }

  stopLiveMode(): void {
    this.isLiveMode.set(false);
    this.isListening.set(false);
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) {
        // ignore
      }
      this.recognition = null;
    }
    if (this.synth) {
      this.synth.cancel();
    }
    this.isSpeaking.set(false);
  }

  speakResponse(text: string): void {
    if (!this.isLiveMode()) return;

    this.isSpeaking.set(true);
    const cleanText = text.replace(/\[\[.*?\]\]/g, '').replace(/\*/g, '');
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.onend = () => {
      this.isSpeaking.set(false);
      if (this.isLiveMode() && this.recognition) {
        try {
            this.recognition.start();
        } catch (e) {
            // Already started or error
        }
      }
    };
    
    this.synth.speak(utterance);
  }

  // --- File & Transcription Logic ---

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!file.type.match(/^(image|video)\//)) {
        alert('Please select an image or video file. For audio, use the transcription button.');
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
  }

  removeAttachment(): void {
      this.attachment.set(null);
  }

  startVoiceTranscription(): void {
    if (this.isTranscribing() || this.isLiveMode() || this.isAssessing()) return;

    const SpeechRecognitionImpl = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      alert('Your browser does not support Speech Recognition. Please use Chrome or Edge.');
      return;
    }

    this.transcriptionRecognition = new SpeechRecognitionImpl();
    this.transcriptionRecognition.continuous = false;
    this.transcriptionRecognition.lang = 'en-US';
    this.transcriptionRecognition.interimResults = false;

    this.transcriptionRecognition.onstart = () => {
      this.isTranscribing.set(true);
    };

    this.transcriptionRecognition.onend = () => {
      this.isTranscribing.set(false);
      this.transcriptionRecognition = null;
    };

    this.transcriptionRecognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        const existingText = this.userResponse().trim();
        const separator = existingText ? ' ' : '';
        this.userResponse.set(existingText + separator + transcript);
      }
    };

    this.transcriptionRecognition.onerror = (event: any) => {
      console.warn('Speech recognition error', event.error);
      this.isTranscribing.set(false);
      this.transcriptionRecognition = null;
    };

    try {
      this.transcriptionRecognition.start();
    } catch (e) {
      console.error('Failed to start recognition', e);
      this.isTranscribing.set(false);
    }
  }


  // --- Main Logic ---

  skipAssessment(): void {
      const summary = "Assessment Skipped. The user is an ABSOLUTE BEGINNER with zero prior experience. Please create a foundational, introductory plan starting from the very basics.";
      
      if (this.transcriptionRecognition) {
        this.transcriptionRecognition.abort();
      }
      this.stopLiveMode();
      
      this.assessmentComplete.emit({ summary, conversation: this.conversation() });
  }

  async submitResponse(): Promise<void> {
    const responseText = this.userResponse().trim();
    if (!responseText && !this.attachment()) return;
    if (this.isAssessing()) return;

    if (this.isLiveMode() && this.recognition) {
        try {
            this.recognition.abort();
        } catch(e) {}
        this.isListening.set(false);
    }

    const userMessage: AssessmentMessage = { 
        role: 'user', 
        text: responseText,
        ...(this.attachment() && { attachment: this.attachment()! })
    };

    this.conversation.update(c => [...c, userMessage]);
    this.userResponse.set('');
    this.attachment.set(null);
    this.isAssessing.set(true);

    const assessmentResult = await this.geminiService.assessSkill(this.config(), this.conversation());
    
    if (assessmentResult.includes('[[ASSESSMENT_COMPLETE]]')) {
        const summary = assessmentResult.replace('[[ASSESSMENT_COMPLETE]]', '').trim();
        const finalMsg = `Assessment complete. Summary: ${summary}`;
        
        this.conversation.update(c => [...c, { role: 'model', text: finalMsg }]);
        
        if (this.isLiveMode()) {
            this.speakResponse("Assessment complete. Generating your plan now.");
            setTimeout(() => {
                this.stopLiveMode();
                this.assessmentComplete.emit({ summary, conversation: this.conversation() });
            }, 3000);
        } else {
            this.assessmentComplete.emit({ summary, conversation: this.conversation() });
        }
    } else {
        this.conversation.update(c => [...c, { role: 'model', text: assessmentResult }]);
        if (this.isLiveMode()) {
            this.speakResponse(assessmentResult);
        }
    }

    this.isAssessing.set(false);
  }
}
