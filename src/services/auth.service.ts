import { Injectable, signal, computed, inject } from '@angular/core';
import { GoogleApiService } from './google-api.service';

declare var google: any;

export interface UserProfile {
  id: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  email: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private googleApiService = inject(GoogleApiService);

  // -------------------------------------------------------------------------
  // DEPLOYMENT CONFIGURATION REQUIRED
  // 1. Create a project in Google Cloud Console.
  // 2. Enable "Google Drive API".
  // 3. Create Credentials > OAuth Client ID > Web Application.
  // 4. Add your deployed domain (e.g. https://myapp.vercel.app) to "Authorized JavaScript origins".
  // 5. Paste the Client ID below.
  // -------------------------------------------------------------------------
  public readonly CLIENT_ID = '985162410268-oj78nhm942fsnsuh5f2mj8s9p464tgfu.apps.googleusercontent.com';
  
  // Used to detect if the user has updated the ID or is still using the demo one
  private readonly DEFAULT_CLIENT_ID = '985162410268-oj78nhm942fsnsuh5f2mj8s9p464tgfu.apps.googleusercontent.com';

  // Using drive.file scope so the app can create/edit its own files without needing full Drive access
  private readonly SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email openid';

  private tokenClient = signal<any>(null);
  
  isInitialized = signal(false);
  tokenResponse = signal<any | null>(null);
  user = signal<UserProfile | null>(null);
  errorMessage = signal<string | null>(null);
  
  isLoggedIn = computed(() => !!this.tokenResponse() && !!this.user());
  
  // Helper for the UI to show the user exactly what URL to authorize in Google Cloud
  public get currentOrigin(): string {
      return window.location.origin;
  }

  public get isLocalhost(): boolean {
      return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  public get isDefaultClient(): boolean {
      return this.CLIENT_ID === this.DEFAULT_CLIENT_ID;
  }

  constructor() {
    console.log('[AuthService] Current Origin:', this.currentOrigin);
    this.initAuth();
  }

  private async initAuth(): Promise<void> {
    try {
      await this.googleApiService.gsiReady;
      this.initializeGis();
    } catch (error) {
      console.error('Failed to initialize Google Sign-In script:', error);
      this.errorMessage.set('Failed to load Google Sign-In. Please check your internet connection.');
    }
  }

  private initializeGis(): void {
    try {
      if (!google || !google.accounts || !google.accounts.oauth2) {
         console.error("Google Accounts API not loaded correctly.");
         return;
      }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.CLIENT_ID,
        scope: this.SCOPES,
        callback: this.handleTokenResponse.bind(this),
        error_callback: (error: any) => {
            console.error('Google Sign-In Error:', error);
            if (error.type === 'popup_closed') {
                this.errorMessage.set(`Popup closed. Ensure '${this.currentOrigin}' is authorized in Google Cloud Console.`);
            } else {
                this.errorMessage.set(`Sign-in failed: ${error.message || error.type || 'Unknown error'}.`);
            }
        }
      });
      this.tokenClient.set(client);
      this.isInitialized.set(true);
    } catch (e) {
      console.error("Error initializing Google Identity Services client:", e);
    }
  }
  
  private async handleTokenResponse(tokenResponse: any): Promise<void> {
    if (tokenResponse && tokenResponse.access_token) {
        this.errorMessage.set(null); // Clear previous errors
        this.tokenResponse.set(tokenResponse);
        this.fetchUserProfile(tokenResponse.access_token);
    } else if (tokenResponse.error) {
        console.error('OAuth Error:', tokenResponse.error);
        this.errorMessage.set(`Sign in failed: ${tokenResponse.error}`);
    }
  }

  private async fetchUserProfile(accessToken: string): Promise<void> {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch user info: ${response.statusText}`);
        }
        const profile = await response.json();
        this.user.set({
            id: profile.sub,
            name: profile.name,
            given_name: profile.given_name,
            family_name: profile.family_name,
            picture: profile.picture,
            email: profile.email,
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        this.signOut();
    }
  }

  signIn(): void {
    this.errorMessage.set(null);
    
    // If we are not on localhost (i.e. we are deployed) but still using the default ID,
    // we block the request and ask the user to configure their own ID.
    if (this.isDefaultClient && !this.isLocalhost) {
        this.errorMessage.set('CONFIG_ERROR_DEPLOYMENT'); 
        return;
    }

    if (!this.isInitialized() || !this.tokenClient()) {
        console.error('Token client not initialized');
        this.errorMessage.set('Authentication service not ready. Please refresh.');
        return;
    }
    
    this.tokenClient()?.requestAccessToken({ prompt: 'consent' });
  }

  signOut(): void {
    const currentToken = this.tokenResponse();
    this.tokenResponse.set(null);
    this.user.set(null);
    this.errorMessage.set(null);
    if(currentToken?.access_token && typeof google !== 'undefined') {
      google.accounts.oauth2.revoke(currentToken.access_token, () => {});
    }
  }
}