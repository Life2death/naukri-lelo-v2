import {
  Button,
  ScrollArea,
  Input,
  Markdown,
} from "@/components";
import { useApp } from "@/contexts";
import { fetchAIResponse, getProfileById } from "@/lib";
import { PageLayout } from "@/layouts";
import { InterviewProfile } from "@/types";
import {
  ArrowLeftIcon,
  Loader2,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
// ArrowLeftIcon is used in the not-found fallback
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are an expert technical interviewer helping a candidate prepare for a job interview.

Your approach:
1. When the user asks to start interview prep, generate 5-8 interview questions progressing from easy to difficult based on their resume and job description.
2. Label each question clearly (Easy / Intermediate / Advanced).
3. After presenting the questions, invite the candidate to pick a question to answer, deep-dive into a topic, or ask for more questions in a specific area.
4. When the user provides an answer or asks a follow-up, give constructive feedback, model answers, or additional questions as appropriate.
5. Keep responses focused, practical, and encouraging.

Use markdown for clear formatting.`;

function buildInitialUserMessage(profile: InterviewProfile): string {
  const parts: string[] = [
    "Please help me prepare for my interview.",
    "",
  ];
  if (profile.goals.trim()) {
    parts.push("**Target Role / Job Description:**");
    parts.push(profile.goals.trim());
    parts.push("");
  }
  if (profile.resumeText.trim()) {
    parts.push("**My Resume:**");
    parts.push(profile.resumeText.trim());
    parts.push("");
  }
  parts.push(
    "Please generate interview questions starting from easy to difficult, tailored to this role and my experience."
  );
  return parts.join("\n");
}

const PrepSession = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedAIProvider, allAiProviders } = useApp();

  const [profile, setProfile] = useState<InterviewProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load profile
  useEffect(() => {
    if (!id) return;
    setProfileLoading(true);
    getProfileById(id)
      .then((p) => setProfile(p))
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [id]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const getProvider = () => {
    if (!selectedAIProvider?.provider) return undefined;
    return allAiProviders?.find((p) => p?.id === selectedAIProvider.provider);
  };

  const sendMessage = async (userText: string) => {
    if (!userText.trim() || isGenerating) return;

    const provider = getProvider();
    if (!provider || !selectedAIProvider) {
      setError(
        "No AI provider configured. Please set up an AI provider in App Settings."
      );
      return;
    }

    setError(null);
    setIsGenerating(true);

    const userMsg: ChatMessage = { role: "user", content: userText.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");

    // Prepare history for the API (all previous messages except the one we just added)
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Add placeholder assistant message
    const assistantIdx = updatedMessages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    abortRef.current = new AbortController();

    try {
      let accumulated = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: SYSTEM_PROMPT,
        history,
        userMessage: userText.trim(),
        signal: abortRef.current.signal,
      })) {
        accumulated += chunk;
        setMessages((prev) => {
          const next = [...prev];
          next[assistantIdx] = { role: "assistant", content: accumulated };
          return next;
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const msg =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(msg);
      // Remove the empty assistant placeholder on error
      setMessages((prev) => prev.filter((_, i) => i !== assistantIdx));
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  const handleStartPrep = () => {
    if (!profile) return;
    sendMessage(buildInitialUserMessage(profile));
  };

  const handleSend = () => {
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
  };

  if (profileLoading) {
    return (
      <PageLayout
        title="Interview Prep"
        description="Loading profile..."
        allowBackButton
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading profile...</span>
        </div>
      </PageLayout>
    );
  }

  if (!profile) {
    return (
      <PageLayout
        title="Interview Prep"
        description="Profile not found"
        allowBackButton
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Profile not found. It may have been deleted.
          </p>
          <Button variant="outline" onClick={() => navigate("/profiles")}>
            <ArrowLeftIcon className="size-4 mr-2" />
            Back to Profiles
          </Button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={`Interview Prep — ${profile.name}`}
      description="AI-powered mock interview session"
      allowBackButton
    >
      <div className="flex flex-col gap-4">
        {/* Profile summary banner */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
          <p className="text-xs font-semibold text-primary">{profile.name}</p>
          {profile.goals && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {profile.goals}
            </p>
          )}
          {profile.resumeText && (
            <p className="text-[10px] text-muted-foreground/60">
              Resume loaded ({profile.resumeText.length.toLocaleString()} chars)
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
            <p className="text-sm text-destructive break-words">{error}</p>
          </div>
        )}

        {/* Chat area */}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
              <SparklesIcon className="size-6 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Ready to practice?</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Click the button below to generate personalized interview
                questions based on your profile.
              </p>
            </div>
            <Button onClick={handleStartPrep} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <SparklesIcon className="size-4" />
                  Generate Interview Questions
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ScrollArea className="h-[calc(100vh-22rem)] rounded-lg border bg-muted/20">
              <div className="p-4 space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col gap-1 ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <span className="text-[10px] font-medium text-muted-foreground uppercase px-1">
                      {msg.role === "user" ? "You" : "AI Interviewer"}
                    </span>
                    <div
                      className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background border"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap break-words">
                          {/* Show short summary for the initial long message */}
                          {idx === 0 && msg.content.length > 200
                            ? "Help me prepare for this interview (with resume & JD)"
                            : msg.content}
                        </p>
                      ) : msg.content ? (
                        <Markdown>{msg.content}</Markdown>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground py-1">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span className="text-xs">Thinking...</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="flex gap-2">
              <Input
                placeholder='Reply, ask a question, or try "deep dive into system design"...'
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isGenerating}
                className="flex-1"
              />
              {isGenerating ? (
                <Button variant="outline" onClick={handleCancel} size="icon">
                  <span className="size-3.5 rounded-sm bg-foreground/70" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim()}
                >
                  <SendIcon className="size-4" />
                </Button>
              )}
            </div>

            {/* Quick prompts */}
            <div className="flex flex-wrap gap-2">
              {[
                "Give me more advanced questions",
                "Deep dive on this topic",
                "Show model answer",
                "How did I do?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => sendMessage(suggestion)}
                  disabled={isGenerating}
                  className="text-xs px-2.5 py-1 rounded-full border border-input hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export default PrepSession;
