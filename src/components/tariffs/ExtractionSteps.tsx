import { CheckCircle2, Loader2, Circle } from "lucide-react";

interface ExtractionStepsProps {
  currentStep: "upload" | "extract" | "review" | "save" | "complete";
}

export default function ExtractionSteps({ currentStep }: ExtractionStepsProps) {
  const steps = [
    { id: "upload", label: "Upload PDF" },
    { id: "extract", label: "AI Extraction" },
    { id: "review", label: "Review Data" },
    { id: "save", label: "Save to Database" },
  ];

  const stepIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center justify-between mb-6">
      {steps.map((step, index) => {
        const isComplete = index < stepIndex;
        const isCurrent = index === stepIndex;
        const isUpcoming = index > stepIndex;

        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isComplete
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                    ? "bg-primary/20 border-2 border-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isComplete ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : isCurrent ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Circle className="w-5 h-5" />
                )}
              </div>
              <span
                className={`text-xs mt-2 ${
                  isCurrent ? "font-semibold" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`h-0.5 flex-1 mx-2 ${
                  isComplete ? "bg-primary" : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
