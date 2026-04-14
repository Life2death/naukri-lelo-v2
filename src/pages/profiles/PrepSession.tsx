import {
  Button,
  ScrollArea,
  Input,
  Markdown,
} from "@/components";
import { useApp } from "@/contexts";
import { useExpandedLayout } from "@/contexts";
import {
  fetchAIResponse,
  getProfileById,
  createConversation,
  generateConversationId,
  generateMessageId,
  addProfileRefConvId,
} from "@/lib";
import { PageLayout } from "@/layouts";
import { InterviewProfile } from "@/types";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CheckIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  Loader2,
  MaximizeIcon,
  MicIcon,
  MinimizeIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const INTERVIEW_SYSTEM_PROMPT = `You are an expert technical interviewer helping a candidate prepare for a job interview.

Your approach:
1. When the user asks to start interview prep, generate 5-8 interview questions progressing from easy to difficult based on their resume and job description.
2. Label each question clearly (Easy / Intermediate / Advanced).
3. After presenting the questions, invite the candidate to pick a question to answer, deep-dive into a topic, or ask for more questions in a specific area.
4. When the user provides an answer or asks a follow-up, give constructive feedback, model answers, or additional questions as appropriate.
5. Keep responses focused, practical, and encouraging.

Use markdown for clear formatting.`;

const ANALYZE_RESUME_PROMPT = `You are an expert career advisor and resume consultant.

Analyze the candidate's resume against the job description provided. Your analysis should:
1. **Match Score** — How well does the resume align with the JD? (provide a rough %)
2. **Strengths** — Key skills and experiences that match the role.
3. **Gaps** — Important keywords, skills, or experiences missing from the resume.
4. **Suggested Improvements** — Specific, actionable changes to better target this role (rewrite bullet points, add keywords, reorder sections, etc.).
5. **Key Talking Points** — 3-5 points the candidate should emphasize in the interview.

Be specific and constructive. Use markdown for clear formatting.`;

function buildInterviewUserMessage(profile: InterviewProfile): string {
  const parts: string[] = ["Please help me prepare for my interview.", ""];
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
  if (profile.documents.length > 0) {
    parts.push("**Additional Documents:**");
    for (const doc of profile.documents) {
      parts.push(`--- ${doc.name} ---`);
      parts.push(doc.text.trim());
      parts.push("");
    }
  }
  parts.push(
    "Please generate interview questions starting from easy to difficult, tailored to this role and my experience."
  );
  return parts.join("\n");
}

function buildAnalyzeUserMessage(profile: InterviewProfile): string {
  const parts: string[] = [];
  if (profile.goals.trim()) {
    parts.push("**Job Description:**");
    parts.push(profile.goals.trim());
    parts.push("");
  }
  if (profile.resumeText.trim()) {
    parts.push("**My Resume:**");
    parts.push(profile.resumeText.trim());
    parts.push("");
  }
  if (parts.length === 0) {
    return "Please analyze my profile and suggest resume improvements.";
  }
  parts.push("Please analyze my resume against this job description and suggest specific improvements.");
  return parts.join("\n");
}

function buildSystemPromptWithDocuments(
  basePrompt: string,
  profile: InterviewProfile
): string {
  if (profile.documents.length === 0) return basePrompt;
  const docSection = profile.documents
    .map((d) => `### ${d.name}\n${d.text.trim()}`)
    .join("\n\n");
  return `${basePrompt}\n\n---\n## Candidate's Reference Documents\nUse these documents as additional context when answering questions:\n\n${docSection}`;
}

function formatConversationAsText(
  messages: ChatMessage[],
  profileName: string
): string {
  const lines: string[] = [
    `Interview Prep Session — ${profileName}`,
    `Exported on ${new Date().toLocaleString()}`,
    "=".repeat(60),
    "",
  ];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      const label = i === 0 ? "You (Start Prep)" : "You";
      lines.push(`[${label}]`);
      lines.push(
        i === 0 && msg.content.length > 200
          ? "Help me prepare for this interview (with resume & JD)"
          : msg.content
      );
    } else {
      lines.push("[AI Interviewer]");
      lines.push(msg.content);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const PrepSession = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedAIProvider, allAiProviders } = useApp();
  const { isExpanded, setIsExpanded } = useExpandedLayout();

  const [profile, setProfile] = useState<InterviewProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isCopied, setIsCopied] = useState(false);
  const [isSavingChat, setIsSavingChat] = useState(false);
  const [isSavedChat, setIsSavedChat] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Collapse expanded mode when leaving the page
  useEffect(() => {
    return () => {
      setIsExpanded(false);
    };
  }, [setIsExpanded]);

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

  const sendMessage = async (
    userText: string,
    opts?: { systemPrompt?: string; isAnalyze?: boolean }
  ) => {
    if (!userText.trim() || isGenerating) return;

    const provider = getProvider();
    if (!provider || !selectedAIProvider) {
      setError(
        "No AI provider configured. Please set up an AI provider in App Settings."
      );
      return;
    }

    const systemPrompt = opts?.systemPrompt
      ? buildSystemPromptWithDocuments(opts.systemPrompt, profile!)
      : buildSystemPromptWithDocuments(INTERVIEW_SYSTEM_PROMPT, profile!);

    setError(null);
    if (opts?.isAnalyze) {
      setIsAnalyzing(true);
    } else {
      setIsGenerating(true);
    }

    const userMsg: ChatMessage = { role: "user", content: userText.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    const assistantIdx = updatedMessages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    abortRef.current = new AbortController();

    try {
      let accumulated = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt,
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
      setMessages((prev) => prev.filter((_, i) => i !== assistantIdx));
    } finally {
      setIsGenerating(false);
      setIsAnalyzing(false);
      abortRef.current = null;
    }
  };

  const handleStartPrep = () => {
    if (!profile) return;
    sendMessage(buildInterviewUserMessage(profile), {
      systemPrompt: INTERVIEW_SYSTEM_PROMPT,
    });
  };

  const handleAnalyzeResume = () => {
    if (!profile) return;
    sendMessage(buildAnalyzeUserMessage(profile), {
      systemPrompt: ANALYZE_RESUME_PROMPT,
      isAnalyze: true,
    });
  };

  const handleSend = () => sendMessage(input);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
    setIsAnalyzing(false);
  };

  const handleCopyConversation = async () => {
    if (!profile || messages.length === 0) return;
    try {
      const text = formatConversationAsText(messages, profile.name);
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard.");
    }
  };

  const handleDownloadConversation = () => {
    if (!profile || messages.length === 0) return;
    const text = formatConversationAsText(messages, profile.name);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.name.replace(/\s+/g, "-")}-prep-session-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToChats = async (asReference = false) => {
    if (!profile || messages.length === 0) return;
    setIsSavingChat(true);
    try {
      const now = Date.now();
      const convId = generateConversationId("chat");
      const title = `Interview Prep — ${profile.name}`;
      const chatMessages = messages
        .filter((m) => m.content.trim())
        .map((m, i) => ({
          id: generateMessageId(m.role, now + i),
          role: m.role as "user" | "assistant",
          content:
            m.role === "user" && i === 0 && m.content.length > 200
              ? "Help me prepare for this interview (with resume & JD)"
              : m.content,
          timestamp: now + i,
        }));

      await createConversation({
        id: convId,
        title,
        messages: chatMessages,
        createdAt: now,
        updatedAt: now,
      });

      // Link to profile as a reference conversation
      if (asReference && id) {
        addProfileRefConvId(id, convId);
      }

      setIsSavedChat(true);
      setTimeout(() => setIsSavedChat(false), 2500);
    } catch {
      setError("Failed to save conversation to chats.");
    } finally {
      setIsSavingChat(false);
    }
  };

  const canAnalyze =
    profile &&
    (profile.resumeText.trim().length > 0 || profile.goals.trim().length > 0);

  const scrollAreaHeight = isExpanded
    ? "h-[calc(100vh-14rem)]"
    : "h-[calc(100vh-26rem)]";

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
      allowBackButton={!isExpanded}
    >
      <div className="flex flex-col gap-4">
        {/* Profile summary banner */}
        {!isExpanded && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
            <p className="text-xs font-semibold text-primary">{profile.name}</p>
            {profile.goals && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {profile.goals}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-1">
              {profile.resumeFileName && (
                <p className="text-[10px] text-muted-foreground/60">
                  Resume: {profile.resumeFileName}
                </p>
              )}
              {profile.documents.length > 0 && (
                <p className="text-[10px] text-muted-foreground/60">
                  {profile.documents.length} custom doc{profile.documents.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        )}

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
                Start prep to generate personalized interview questions, or analyze your resume against the job description.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                onClick={handleStartPrep}
                disabled={isGenerating || isAnalyzing}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="size-4" />
                    Start Prep
                  </>
                )}
              </Button>
              {canAnalyze && (
                <Button
                  variant="outline"
                  onClick={handleAnalyzeResume}
                  disabled={isGenerating || isAnalyzing}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <MicIcon className="size-4" />
                      Analyze Resume
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Conversation toolbar */}
            <div className="flex items-center gap-2 justify-between flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartPrep}
                  disabled={isGenerating || isAnalyzing}
                  className="h-7 text-xs gap-1 px-2"
                >
                  <SparklesIcon className="size-3.5" />
                  New Prep
                </Button>
                {canAnalyze && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAnalyzeResume}
                    disabled={isGenerating || isAnalyzing}
                    className="h-7 text-xs gap-1 px-2"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <MicIcon className="size-3.5" />
                    )}
                    Analyze Resume
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Expand / Minimize */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="h-7 text-xs gap-1 px-2"
                  title={isExpanded ? "Minimize" : "Expand to full screen"}
                >
                  {isExpanded ? (
                    <>
                      <MinimizeIcon className="size-3.5" />
                      Minimize
                    </>
                  ) : (
                    <>
                      <MaximizeIcon className="size-3.5" />
                      Expand
                    </>
                  )}
                </Button>

                {/* Copy */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyConversation}
                  disabled={messages.length === 0}
                  className="h-7 text-xs gap-1 px-2"
                  title="Copy conversation to clipboard"
                >
                  {isCopied ? (
                    <>
                      <CheckIcon className="size-3.5 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <ClipboardCopyIcon className="size-3.5" />
                      Copy
                    </>
                  )}
                </Button>

                {/* Download .txt */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDownloadConversation}
                  disabled={messages.length === 0}
                  className="h-7 text-xs gap-1 px-2"
                  title="Download conversation as .txt file"
                >
                  <DownloadIcon className="size-3.5" />
                  Download
                </Button>

                {/* Save to Chats */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSaveToChats(false)}
                  disabled={messages.length === 0 || isSavingChat}
                  className="h-7 text-xs gap-1 px-2"
                  title="Save to Chats"
                >
                  {isSavingChat ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : isSavedChat ? (
                    <>
                      <CheckIcon className="size-3.5 text-green-500" />
                      Saved!
                    </>
                  ) : (
                    <>
                      <BookmarkIcon className="size-3.5" />
                      Save to Chats
                    </>
                  )}
                </Button>

                {/* Save as Reference (links to profile knowledge hub) */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSaveToChats(true)}
                  disabled={messages.length === 0 || isSavingChat}
                  className="h-7 text-xs gap-1 px-2 text-primary hover:text-primary"
                  title="Save as Reference — this conversation will be added to the profile knowledge hub and used as context when you select this profile on the overlay"
                >
                  <SparklesIcon className="size-3.5" />
                  Save as Reference
                </Button>
              </div>
            </div>

            {/* Reference save tip */}
            <div className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-2">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                <span className="font-semibold text-primary">Tip:</span> If this session went well, click <strong>Save as Reference</strong> — it will be added to your profile knowledge hub and the AI will reference it when you select this profile on the overlay during an interview.
              </p>
            </div>

            <ScrollArea className={`${scrollAreaHeight} rounded-lg border bg-muted/20`}>
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
                disabled={isGenerating || isAnalyzing}
                className="flex-1"
              />
              {isGenerating || isAnalyzing ? (
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
                  disabled={isGenerating || isAnalyzing}
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
