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
import { Loader2 } from "lucide-react";

export interface ProfileFormData {
  id?: string;
  name: string;
  resumeText: string;
  goals: string;
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

          {/* Resume */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Resume{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (optional — paste text)
              </span>
            </label>
            <Textarea
              placeholder="Paste your resume text here. The AI will use this to generate questions tailored to your experience..."
              className="min-h-[160px] resize-none"
              value={form.resumeText}
              onChange={(e) =>
                setForm((f) => ({ ...f, resumeText: e.target.value }))
              }
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground/70">
              Tip: Copy and paste your resume as plain text for best results.
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
