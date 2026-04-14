import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Textarea,
} from "@/components";
import { extractTextFromFile } from "@/lib";
import { InterviewProfileDocument } from "@/types";
import { Loader2, PaperclipIcon, Trash2, UploadIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

export interface ProfileFormData {
  id?: string;
  name: string;
  resumeText: string;
  resumeFileName: string;
  goals: string;
  documents: InterviewProfileDocument[];
}

interface ProfileFormDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  form: ProfileFormData;
  setForm: React.Dispatch<React.SetStateAction<ProfileFormData>>;
  onSave: () => void;
  isEditing?: boolean;
  isSaving?: boolean;
}

export const ProfileFormDialog = ({
  isOpen,
  onOpenChange,
  form,
  setForm,
  onSave,
  isEditing = false,
  isSaving = false,
}: ProfileFormDialogProps) => {
  const isValid = form.name.trim().length > 0;

  const resumeInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);

  const [isExtractingResume, setIsExtractingResume] = useState(false);
  const [isExtractingDoc, setIsExtractingDoc] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const handleResumeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractError(null);
    setIsExtractingResume(true);
    try {
      const text = await extractTextFromFile(file);
      setForm((f) => ({ ...f, resumeText: text, resumeFileName: file.name }));
    } catch (err: any) {
      setExtractError(err?.message ?? "Failed to read file");
    } finally {
      setIsExtractingResume(false);
      // Reset so same file can be re-selected
      if (resumeInputRef.current) resumeInputRef.current.value = "";
    }
  };

  const handleRemoveResume = () => {
    setForm((f) => ({ ...f, resumeText: "", resumeFileName: "" }));
  };

  const handleDocFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setExtractError(null);
    setIsExtractingDoc(true);
    try {
      const newDocs: InterviewProfileDocument[] = [];
      for (const file of files) {
        // Skip duplicates by name
        if (form.documents.some((d) => d.name === file.name)) continue;
        const text = await extractTextFromFile(file);
        newDocs.push({ name: file.name, text });
      }
      if (newDocs.length > 0) {
        setForm((f) => ({ ...f, documents: [...f.documents, ...newDocs] }));
      }
    } catch (err: any) {
      setExtractError(err?.message ?? "Failed to read document");
    } finally {
      setIsExtractingDoc(false);
      if (docsInputRef.current) docsInputRef.current.value = "";
    }
  };

  const handleRemoveDoc = (name: string) => {
    setForm((f) => ({ ...f, documents: f.documents.filter((d) => d.name !== name) }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="mt-4 px-6 shrink-0">
          <DialogTitle>
            {isEditing ? "Edit Profile" : "Create Interview Profile"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update your profile details."
              : "Add your resume and goals to generate tailored interview questions."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 px-6 overflow-y-auto flex-1">
          {/* Profile Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Profile Name</label>
            <Input
              placeholder="e.g., Senior React Engineer at Stripe"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={isSaving}
              className="h-11"
            />
          </div>

          {/* Goals / Job Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Goals / Job Description</label>
            <Textarea
              placeholder="Paste the job description, or describe the role you're targeting and what you want to achieve in this interview prep session..."
              className="min-h-[120px] resize-none"
              value={form.goals}
              onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
              disabled={isSaving}
            />
          </div>

          {/* Resume Upload */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Resume{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (optional — PDF or Word)
              </span>
            </label>

            {form.resumeFileName ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <PaperclipIcon className="size-4 text-primary shrink-0" />
                <span className="text-sm flex-1 truncate text-primary font-medium">
                  {form.resumeFileName}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {form.resumeText.length.toLocaleString()} chars
                </span>
                <button
                  onClick={handleRemoveResume}
                  disabled={isSaving}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove resume"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isSaving || isExtractingResume}
                onClick={() => resumeInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input hover:border-primary/40 hover:bg-accent/50 transition-colors py-6 text-sm text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExtractingResume ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Reading file...
                  </>
                ) : (
                  <>
                    <UploadIcon className="size-4" />
                    Click to upload resume (.pdf, .doc, .docx)
                  </>
                )}
              </button>
            )}

            <input
              ref={resumeInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={handleResumeFileChange}
            />
          </div>

          {/* Custom Documents */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Custom Documents{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (optional — used as AI memory during prep)
              </span>
            </label>

            {form.documents.length > 0 && (
              <div className="space-y-1.5">
                {form.documents.map((doc) => (
                  <div
                    key={doc.name}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/30"
                  >
                    <PaperclipIcon className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1 truncate">{doc.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {doc.text.length.toLocaleString()} chars
                    </span>
                    <button
                      onClick={() => handleRemoveDoc(doc.name)}
                      disabled={isSaving}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove document"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={isSaving || isExtractingDoc}
              onClick={() => docsInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-input hover:border-primary/40 hover:bg-accent/50 transition-colors py-3 text-sm text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExtractingDoc ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Reading document...
                </>
              ) : (
                <>
                  <UploadIcon className="size-4" />
                  Add document (.pdf, .doc, .docx)
                </>
              )}
            </button>

            <input
              ref={docsInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              multiple
              className="hidden"
              onChange={handleDocFilesChange}
            />

            {extractError && (
              <p className="text-xs text-destructive">{extractError}</p>
            )}

            <p className="text-xs text-muted-foreground/70">
              Upload certifications, cover letters, or any document you want the AI to reference when answering questions.
            </p>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!isValid || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEditing ? "Updating..." : "Creating..."}
              </>
            ) : isEditing ? (
              "Update"
            ) : (
              "Create Profile"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
