export type ConditionalFlow = {
  followUp?: string;
  noAgain?: string;
  annual?: string;
};

export type QuestionsFile = {
  intro: { greeting: string };
  questions: string[];
  conditionalFlows: {
    initialResponse: { no: ConditionalFlow; yes: ConditionalFlow };
    priceNegotiable: { yes: ConditionalFlow };
    tenantOccupied: { yes: ConditionalFlow };
  };
  rebuttals: Record<string, string>;
  closing: {
    thankYou: string;
    interestScale: string;
    interestThreshold: { low: string; high: string };
  };
  reminders: string[];
};

export type ConversationDataLike = {
  currentQuestionIndex: number;
  answers: Record<string, string>;
  skipQuestions: number[];
  interestedInSelling: boolean | null;
};

export type FlowResult = {
  response: string | null;

  // Optional overrides to apply
  nextQuestionIndex?: number;
  skipQuestionsToAdd?: number[];
  interestedInSelling?: boolean | null;
};

const NEGATIVE_RE = /\b(no|nope|not really|never|don't think so)\b/i;
const POSITIVE_RE = /\b(yes|yeah|sure|definitely|absolutely|maybe|possibly)\b/i;

export function evaluateConditionalFlow(params: {
  script: QuestionsFile;
  questionIdx: number;
  answer: string;
  convData: ConversationDataLike;
}): FlowResult {
  const { script, questionIdx, answer, convData } = params;

  const lowerAnswer = answer.toLowerCase();
  const isNegative = NEGATIVE_RE.test(lowerAnswer);
  const isPositive = POSITIVE_RE.test(lowerAnswer);

  // Q0: Have you ever considered selling?
  if (questionIdx === 0) {
    if (isNegative) {
      return {
        response: script.conditionalFlows.initialResponse.no.followUp ?? null,
        nextQuestionIndex: 1,
        interestedInSelling: false,
      };
    }

    if (isPositive) {
      return {
        response: `${script.conditionalFlows.initialResponse.yes.followUp}\n\n${script.questions[3]}`,
        nextQuestionIndex: 3,
        skipQuestionsToAdd: [1, 2],
        interestedInSelling: true,
      };
    }
  }

  // Q1: Consider in near future?
  if (questionIdx === 1 && isNegative) {
    return {
      response: script.conditionalFlows.initialResponse.no.noAgain ?? null,
      nextQuestionIndex: 2,
    };
  }

  // Q4: Is price negotiable?
  if (questionIdx === 4 && isPositive) {
    return {
      response: script.conditionalFlows.priceNegotiable.yes.followUp ?? null,
      nextQuestionIndex: 5,
    };
  }

  // Q15: Property occupied by tenants?
  if (questionIdx === 15 && /\b(tenant|renter|rent)\b/.test(lowerAnswer)) {
    return {
      response: script.conditionalFlows.tenantOccupied.yes.followUp ?? null,
      nextQuestionIndex: 16,
    };
  }

  // Q16: Monthly or annual lease?
  if (questionIdx === 16 && /\b(annual|yearly|year)\b/.test(lowerAnswer)) {
    return {
      response: script.conditionalFlows.tenantOccupied.yes.annual ?? null,
      nextQuestionIndex: 17,
    };
  }

  // Skip tenant questions if owner-occupied
  if (questionIdx === 15 && /\b(me|myself|i live|owner)\b/.test(lowerAnswer)) {
    return {
      response: null,
      skipQuestionsToAdd: [16, 17],
      // keep current index progression handled by caller.service
    };
  }

  return { response: null };
}
