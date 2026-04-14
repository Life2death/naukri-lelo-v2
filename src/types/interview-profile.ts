export interface InterviewProfileDocument {
  name: string;
  text: string;
}

export interface InterviewProfile {
  id: string;
  name: string;
  /** Candidate's first name — used in the interview persona (e.g. "Vikram") */
  firstName: string;
  /** AI-generated first-person interview persona stored so it doesn't need re-generating */
  persona: string;
  resumeText: string;
  resumeFileName: string;
  goals: string;
  documents: InterviewProfileDocument[];
  createdAt: number;
  updatedAt: number;
}
