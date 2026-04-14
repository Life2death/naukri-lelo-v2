export interface InterviewProfileDocument {
  name: string;
  text: string;
}

export interface InterviewProfile {
  id: string;
  name: string;
  resumeText: string;
  resumeFileName: string;
  goals: string;
  documents: InterviewProfileDocument[];
  createdAt: number;
  updatedAt: number;
}
