import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GoogleApiService {
  public readonly gsiReady: Promise<void>;
  public readonly gapiReady: Promise<void>;

  constructor() {
    this.gsiReady = this.loadScript('https://accounts.google.com/gsi/client', 'google', (w) => !!w.google?.accounts);
    this.gapiReady = this.loadScript('https://apis.google.com/js/api.js', 'gapi', (w) => !!w.gapi);
  }

  private loadScript(src: string, globalKey: string, checkFn?: (window: any) => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use the custom check function if provided, otherwise fallback to simple property check
      const isReady = checkFn ? checkFn(window) : (window as any)[globalKey];
      
      if (isReady) {
        resolve();
        return;
      }

      // Check if script tag already exists
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve(); 
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = (error) => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }
}
