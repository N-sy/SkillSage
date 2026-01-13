import { Injectable, signal, inject, effect } from '@angular/core';
import { LearningPlan } from '../models';
import { AuthService } from './auth.service';
import { GoogleApiService } from './google-api.service';

declare var gapi: any;

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const PLANS_FILE_NAME = 'skill-sage-plans.json';

@Injectable({ providedIn: 'root' })
export class DriveService {
  private authService = inject(AuthService);
  private googleApiService = inject(GoogleApiService);
  private isGapiReady = signal(false);
  private gapiInitializationPromise: Promise<void> | null = null;
  private fileId = signal<string | null>(null);

  constructor() {
    effect(() => {
        // If user logs out and gapi was initialized, clear the token.
        if (!this.authService.isLoggedIn() && this.isGapiReady()) {
            if (typeof gapi !== 'undefined' && gapi.client) {
              gapi.client.setToken(null);
            }
        }
    });
  }
  
  private initializeGapiClient(): Promise<void> {
      return new Promise<void>(resolve => gapi.load('client', resolve))
        .then(() => gapi.client.init({
            discoveryDocs: [DISCOVERY_DOC],
        }))
        .then(() => {
            this.isGapiReady.set(true);
            const token = this.authService.tokenResponse();
            if (token) {
                gapi.client.setToken(token);
            }
        });
  }

  private ensureGapiReady(): Promise<void> {
    if (!this.gapiInitializationPromise) {
        this.gapiInitializationPromise = new Promise(async (resolve, reject) => {
            try {
                await this.googleApiService.gapiReady;
                await this.initializeGapiClient();
                resolve();
            } catch (error) {
                console.error('Failed to initialize Google Drive API', error);
                reject(error);
            }
        });
    }
    return this.gapiInitializationPromise;
  }
  
  private async _getFileId(): Promise<string | null> {
    if (this.fileId()) {
      return this.fileId();
    }
    
    await this.ensureGapiReady();

    try {
      // Reverted to standard file search (no spaces parameter)
      const response = await gapi.client.drive.files.list({
        fields: 'files(id, name)',
        q: `name='${PLANS_FILE_NAME}' and trashed=false`,
      });
      const file = response.result.files?.[0];
      if (file) {
        this.fileId.set(file.id);
        return file.id;
      }
      return null;
    } catch (e) {
      console.error('Error finding file ID', e);
      return null;
    }
  }

  async getPlans(): Promise<LearningPlan[]> {
    await this.ensureGapiReady();
    const fileId = await this._getFileId();

    if (!fileId) {
      return [];
    }

    try {
      const response = await gapi.client.drive.files.get({
        fileId: fileId,
        alt: 'media',
      });
      return response.result as LearningPlan[];
    } catch (e: any) {
        if (e.status === 404) {
            console.warn('Plans file not found on Drive. A new one will be created on next save.');
            return [];
        }
        console.error('Error fetching plans from Drive', e);
        return [];
    }
  }

  async savePlans(plans: LearningPlan[]): Promise<void> {
    await this.ensureGapiReady();
    const fileId = await this._getFileId();
    const content = JSON.stringify(plans);
    const blob = new Blob([content], { type: 'application/json' });
    
    const form = new FormData();

    if (fileId) {
      // Update existing file
      form.append('metadata', new Blob([JSON.stringify({})], { type: 'application/json' }));
      form.append('file', blob);

      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` },
        body: form,
      });

    } else {
      // Create new file in root (parents not specified)
      const metadata = { name: PLANS_FILE_NAME }; 
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` },
        body: form,
      });
      const newFile = await response.json();
      this.fileId.set(newFile.id);
    }
  }
}