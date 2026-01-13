import { Injectable, signal, inject, effect } from '@angular/core';
import { LearningPlan, UserSchedule } from '../models';
import { AuthService } from './auth.service';
import { DriveService } from './drive.service';

interface StoredPlansContainer {
  version: number;
  plans: LearningPlan[];
}

@Injectable({
  providedIn: 'root',
})
export class PersistenceService {
  private readonly PLANS_STORAGE_KEY = 'skillSagePlans';
  private readonly SCHEDULE_STORAGE_KEY = 'skillSageSchedule';
  private readonly DATA_VERSION = 2;
  
  public plans = signal<LearningPlan[]>([]);
  public userSchedule = signal<UserSchedule | null>(null);

  private authService = inject(AuthService);
  private driveService = inject(DriveService);

  private isMigrating = signal(false);

  constructor() {
    this.loadScheduleFromStorage();

    effect(() => {
      // This effect runs whenever the initialization or login state changes.
      if (!this.authService.isInitialized()) return;

      if (this.authService.isLoggedIn()) {
        this.loadPlansFromDriveWithMigration();
      } else {
        this.loadPlansFromLocalStorage();
      }
    });
  }

  private runMigrations(data: any): LearningPlan[] {
    let version = 1;
    let plans: LearningPlan[] = [];

    if (Array.isArray(data)) {
      version = 1;
      plans = data;
    } else if (typeof data === 'object' && data !== null && 'version' in data) {
      version = data.version;
      plans = data.plans;
    } else {
      return [];
    }

    if (version < 2) {
      plans = plans.map(plan => ({
        ...plan,
        creationDate: plan.creationDate || plan.id,
        dailyLogs: plan.dailyLogs || [],
      }));
    }
    
    return plans;
  }

  private loadPlansFromLocalStorage(): void {
    try {
      const storedData = localStorage.getItem(this.PLANS_STORAGE_KEY);
      if (storedData) {
        const parsedData = JSON.parse(storedData);
        const migratedPlans = this.runMigrations(parsedData);
        this.plans.set(migratedPlans);
      } else {
        this.plans.set([]);
      }
    } catch (e) {
      console.error('Error loading plans from local storage', e);
      this.plans.set([]);
    }
  }

  private async loadPlansFromDriveWithMigration(): Promise<void> {
    if (this.isMigrating()) return;
    this.isMigrating.set(true);
    
    try {
      // 1. Check for local plans that need migrating.
      const localData = localStorage.getItem(this.PLANS_STORAGE_KEY);
      const localPlans = localData ? this.runMigrations(JSON.parse(localData)) : [];
      
      // 2. Load plans currently in Drive.
      let drivePlans = await this.driveService.getPlans();

      // 3. If local plans exist, merge them into Drive.
      if (localPlans.length > 0) {
        // Simple merge: add local plans to drive plans, assuming local is more recent for any conflicts.
        const planIdsInDrive = new Set(drivePlans.map(p => p.id));
        const plansToMigrate = localPlans.filter(p => !planIdsInDrive.has(p.id));
        const mergedPlans = [...drivePlans, ...plansToMigrate];
        
        await this.driveService.savePlans(mergedPlans);
        localStorage.removeItem(this.PLANS_STORAGE_KEY); // Clear local after successful migration.
        this.plans.set(mergedPlans);
      } else {
        this.plans.set(drivePlans);
      }
    } catch (e) {
      console.error('Error during Drive sync and migration', e);
      // Fallback to local storage on error
      this.loadPlansFromLocalStorage();
    } finally {
      this.isMigrating.set(false);
    }
  }

  private loadScheduleFromStorage(): void {
    try {
      const storedSchedule = localStorage.getItem(this.SCHEDULE_STORAGE_KEY);
      if (storedSchedule) {
        this.userSchedule.set(JSON.parse(storedSchedule));
      }
    } catch (e) {
      console.error('Error loading schedule from local storage', e);
    }
  }

  savePlan(plan: LearningPlan): void {
    if (this.authService.isLoggedIn()) {
      this.plans.update(plans => {
        const existingIndex = plans.findIndex(p => p.id === plan.id);
        const updatedPlans = (existingIndex > -1)
          ? plans.map((p, i) => i === existingIndex ? plan : p)
          : [...plans, plan];
        this.driveService.savePlans(updatedPlans).catch(e => console.error("Failed to save to Drive", e));
        return updatedPlans;
      });
    } else {
      this.plans.update(plans => {
        const existingIndex = plans.findIndex(p => p.id === plan.id);
        const updatedPlans = (existingIndex > -1)
          ? plans.map((p, i) => i === existingIndex ? plan : p)
          : [...plans, plan];
        this.persistPlansToLocalStorage(updatedPlans);
        return updatedPlans;
      });
    }
  }

  deletePlan(planId: string): void {
    if (this.authService.isLoggedIn()) {
       this.plans.update(plans => {
        const updatedPlans = plans.filter(p => p.id !== planId);
        this.driveService.savePlans(updatedPlans).catch(e => console.error("Failed to delete from Drive", e));
        return updatedPlans;
      });
    } else {
      this.plans.update(plans => {
        const updatedPlans = plans.filter(p => p.id !== planId);
        this.persistPlansToLocalStorage(updatedPlans);
        return updatedPlans;
      });
    }
  }
  
  getPlan(planId: string): LearningPlan | undefined {
    return this.plans().find(p => p.id === planId);
  }

  saveSchedule(schedule: UserSchedule): void {
    this.userSchedule.set(schedule);
    try {
      localStorage.setItem(this.SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
    } catch (e) {
      console.error('Error saving schedule to local storage', e);
    }
  }

  clearSchedule(): void {
    this.userSchedule.set(null);
    try {
      localStorage.removeItem(this.SCHEDULE_STORAGE_KEY);
    } catch (e) {
      console.error('Error clearing schedule from local storage', e);
    }
  }

  private persistPlansToLocalStorage(plans: LearningPlan[]): void {
    try {
      const dataToStore: StoredPlansContainer = {
        version: this.DATA_VERSION,
        plans: plans,
      };
      localStorage.setItem(this.PLANS_STORAGE_KEY, JSON.stringify(dataToStore));
    } catch (e) {
      console.error('Error saving plans to local storage', e);
    }
  }
}