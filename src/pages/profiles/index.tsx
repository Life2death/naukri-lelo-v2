import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  Input,
} from "@/components";
import { useProfiles } from "@/hooks";
import {
  MoreHorizontal,
  Pencil,
  PlayCircle,
  PlusIcon,
  Search,
  Trash2,
  UserCircle2Icon,
} from "lucide-react";
import { PageLayout } from "@/layouts";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import moment from "moment";
import { ProfileFormData, ProfileFormDialog } from "./ProfileFormDialog";

const EMPTY_FORM: ProfileFormData = {
  name: "",
  resumeText: "",
  resumeFileName: "",
  goals: "",
  documents: [],
};

const Profiles = () => {
  const { profiles, isLoading, addProfile, editProfile, removeProfile } =
    useProfiles();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<ProfileFormData>(EMPTY_FORM);

  const filtered = profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.goals.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateClick = () => {
    setForm(EMPTY_FORM);
    setIsDialogOpen(true);
  };

  const handleEditClick = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setForm({
      id: p.id,
      name: p.name,
      resumeText: p.resumeText,
      resumeFileName: p.resumeFileName,
      goals: p.goals,
      documents: p.documents,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (form.id) {
        await editProfile(form.id, {
          name: form.name,
          resumeText: form.resumeText,
          resumeFileName: form.resumeFileName,
          goals: form.goals,
          documents: form.documents,
        });
      } else {
        await addProfile({
          name: form.name,
          resumeText: form.resumeText,
          resumeFileName: form.resumeFileName,
          goals: form.goals,
          documents: form.documents,
        });
      }
      setIsDialogOpen(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error("Failed to save profile:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageLayout
      title="Interview Profiles"
      description="Create profiles with your resume and target role to generate personalized interview questions"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 justify-between">
        <div className="relative w-full md:w-1/2 lg:w-1/3">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search profiles..."
            className="pl-9 focus-visible:ring-0 focus-visible:ring-offset-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={handleCreateClick}>
          <PlusIcon className="size-4" />
          New Profile
        </Button>
      </div>

      {/* Profile Cards */}
      {filtered.length === 0 ? (
        <Empty
          isLoading={isLoading}
          icon={UserCircle2Icon}
          title="No profiles yet"
          description="Create your first interview profile to get started"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 pb-4">
          {filtered.map((profile) => (
            <Card
              key={profile.id}
              className="relative shadow-none p-4 pb-12 gap-0 !bg-black/5 dark:!bg-white/5 hover:border-primary/40 transition-all"
            >
              <CardHeader className="p-0 select-none">
                <CardTitle className="text-sm line-clamp-1">
                  {profile.name}
                </CardTitle>
                {profile.goals ? (
                  <CardDescription className="text-xs line-clamp-3 leading-relaxed mt-1">
                    {profile.goals}
                  </CardDescription>
                ) : null}
                {profile.resumeFileName ? (
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Resume: {profile.resumeFileName}
                  </p>
                ) : profile.resumeText ? (
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Resume: {profile.resumeText.length.toLocaleString()} chars
                  </p>
                ) : null}
                {profile.documents.length > 0 ? (
                  <p className="text-[10px] text-muted-foreground/60">
                    {profile.documents.length} custom doc{profile.documents.length !== 1 ? "s" : ""}
                  </p>
                ) : null}
              </CardHeader>

              {/* Footer row */}
              <div className="absolute bottom-2 left-4 right-4 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground select-none">
                  {moment(profile.updatedAt).format("MMM D, YYYY")}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 px-2"
                    onClick={() => navigate(`/profiles/${profile.id}/prep`)}
                    title="Start interview prep"
                  >
                    <PlayCircle className="size-3.5" />
                    Start Prep
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-accent">
                        <MoreHorizontal className="size-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem onClick={() => handleEditClick(profile.id)}>
                        <Pencil className="size-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => removeProfile(profile.id)}
                      >
                        <Trash2 className="size-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ProfileFormDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        form={form}
        setForm={setForm}
        onSave={handleSave}
        isEditing={!!form.id}
        isSaving={isSaving}
      />
    </PageLayout>
  );
};

export default Profiles;
