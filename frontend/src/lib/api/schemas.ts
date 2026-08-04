import { z } from "zod";

// ── Common enums ──

export const gender = z.enum(["MALE", "FEMALE"]);
export const problemAnswer = z.enum(["A", "B", "C", "D"]);
export const pretestConfidence = z.enum(["NOT_SURE", "SOMEWHAT_SURE", "VERY_SURE"]);

export const studySubjectStatus = z.enum([
  "CURRICULUM_QUEUING",
  "CURRICULUM_FETCHING",
  "PRETEST_QUEUING",
  "PRETEST_GENERATING",
  "PRETEST_READY",
  "PLAN_QUEUING",
  "PLAN_GENERATING",
  "STUDYING",
  "FINISHED",
  "FAILED",
]);

export const studyStageStatus = z.enum(["LOCKED", "STUDYING", "FINISHED"]);
export const studyTaskStatus = z.enum(["LOCKED", "STUDYING", "FINISHED"]);
export type StudyTaskStatus = z.infer<typeof studyTaskStatus>;
export const studyQuizStatus = z.enum(["QUEUING", "GENERATING", "READY", "SUBMITTED", "FAILED"]);
export const resourceStatus = z.enum(["QUEUING", "GENERATING", "FINISHED", "FAILED"]);

// ── User ──

export const userSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  birth_year: z.number().int().nullable(),
  gender: gender.nullable(),
  introduction: z.string(),
  exp: z.number().int(),
  gold: z.number().int(),
  diamond: z.number().int(),
  total_checkins: z.number().int(),
  streak_checkins: z.number().int(),
  last_checkin: z.string().nullable(),
  last_login: z.string().nullable(),
  active_study_subject_id: z.number().int().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type User = z.infer<typeof userSchema>;

export const meProfileSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  birth_year: z.number().int().nullable(),
  gender: gender.nullable(),
  introduction: z.string(),
  active_study_subject_id: z.number().int().nullable(),
});
export type MeProfile = z.infer<typeof meProfileSchema>;

export const assetKindSchema = z.enum(["EXP", "GOLD", "DIAMOND"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetTransactionSchema = z.object({
  id: z.number().int(),
  asset: assetKindSchema,
  amount: z.number().int(),
  balance_after: z.number().int(),
  title: z.string(),
  created_at: z.number().int(),
});
export type AssetTransaction = z.infer<typeof assetTransactionSchema>;

export const assetOverviewSchema = z.object({
  exp: z.number().int(),
  gold: z.number().int(),
  diamond: z.number().int(),
  transactions: z.array(assetTransactionSchema),
});
export type AssetOverview = z.infer<typeof assetOverviewSchema>;

export const tokenSchema = z.object({ token: z.string() });
export type Token = z.infer<typeof tokenSchema>;

// ── Checkin ──

export const checkinResponseSchema = z.object({
  checkin_date: z.string(),
  gold_reward: z.number().int(),
  exp_reward: z.number().int(),
  makeup_applied: z.boolean(),
  makeup_days: z.number().int(),
  diamond_cost: z.number().int(),
  gold_cost: z.number().int(),
  total_checkins: z.number().int(),
  streak_checkins: z.number().int(),
});
export type CheckinResponse = z.infer<typeof checkinResponseSchema>;

export const checkinListItemSchema = z.object({
  checkin_date: z.string(),
  gold_reward: z.number().int(),
});
export const checkinListSchema = z.array(checkinListItemSchema);
export type CheckinListItem = z.infer<typeof checkinListItemSchema>;

// ── Pretest problem ──

export const pretestProblemSchema = z.object({
  id: z.number().int(),
  sort_order: z.number().int(),
  content: z.string(),
  choice_a: z.string(),
  choice_b: z.string(),
  choice_c: z.string(),
  choice_d: z.string(),
  answer: problemAnswer,
  explanation: z.string(),
  confidence: pretestConfidence.nullable(),
  chosen_answer: problemAnswer.nullable(),
});
export type PretestProblem = z.infer<typeof pretestProblemSchema>;
export const pretestListSchema = z.array(pretestProblemSchema);

// ── Study subject ──

export const studyLanguage = z.enum(["PYTHON", "JAVA", "CPP", "GO", "RUST"]);
export type StudyLanguage = z.infer<typeof studyLanguage>;

export const studySubjectSchema = z.object({
  id: z.number().int(),
  subject: z.string(),
  status: studySubjectStatus,
  total_stages: z.number().int(),
  finished_stages: z.number().int(),
  diamond_cost: z.number().int(),
  language: z.string(),
  target: z.string(),
  curriculum_template_id: z.number().int().nullable(),
  failure_code: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export const studySubjectListSchema = z.array(studySubjectSchema);
export type StudySubject = z.infer<typeof studySubjectSchema>;

// ── Public config ──

export const studySubjectPricingItemSchema = z.object({
  total_stages: z.number().int(),
  diamond_cost: z.number().int(),
});
export type StudySubjectPricingItem = z.infer<typeof studySubjectPricingItemSchema>;

export const storageConfigSchema = z.object({
  public_base: z.url(),
  bucket: z.string(),
});
export type StorageConfig = z.infer<typeof storageConfigSchema>;

export const resourceConfigSchema = z.object({
  knowledge_video_diamond_cost: z.number().int(),
  code_video_diamond_cost: z.number().int(),
  interactive_html_diamond_cost: z.number().int(),
  study_quiz_free_limit_per_task: z.number().int(),
  study_quiz_extra_gold_cost: z.number().int(),
});
export type ResourceConfig = z.infer<typeof resourceConfigSchema>;

export const checkinConfigSchema = z.object({
  reward_sequence: z.array(z.number().int()),
  makeup_gold_cost_per_day: z.number().int(),
  makeup_diamond_cost: z.number().int(),
});
export type CheckinConfig = z.infer<typeof checkinConfigSchema>;

export const experienceConfigSchema = z.object({
  checkin_reward: z.number().int(),
  study_task_reward: z.number().int(),
  study_quiz_reward: z.number().int(),
  study_subject_reward: z.number().int(),
});
export type ExperienceConfig = z.infer<typeof experienceConfigSchema>;

export const publicConfigSchema = z.object({
  study_subject: z.object({
    pricing: z.array(studySubjectPricingItemSchema),
    completion_refund_percent: z.number().int().min(0).max(100),
  }),
  storage: storageConfigSchema,
  resource: resourceConfigSchema,
  checkin: checkinConfigSchema,
  experience: experienceConfigSchema,
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export const createKnowledgeVideoResponseSchema = z.object({
  knowledge_video_id: z.number().int(),
});
export type CreateKnowledgeVideoResponse = z.infer<
  typeof createKnowledgeVideoResponseSchema
>;

export const createKnowledgeExplanationResponseSchema = z.object({
  knowledge_explanation_id: z.number().int(),
});
export type CreateKnowledgeExplanationResponse = z.infer<
  typeof createKnowledgeExplanationResponseSchema
>;

export const createInteractiveHtmlResponseSchema = z.object({
  interactive_html_id: z.number().int(),
});
export type CreateInteractiveHtmlResponse = z.infer<
  typeof createInteractiveHtmlResponseSchema
>;

export const createStudyQuizResponseSchema = z.object({
  quiz_id: z.number().int(),
  cost: z.number().int(),
});
export type CreateStudyQuizResponse = z.infer<
  typeof createStudyQuizResponseSchema
>;

export const submitStudyQuizResponseSchema = z.object({
  correct_problems: z.number().int(),
  exp_reward: z.number().int(),
});

export const completeStudyTaskResponseSchema = z.object({
  success: z.boolean(),
  exp_reward: z.number().int(),
  diamond_refund: z.number().int(),
  subject_completed: z.boolean(),
});
export type CompleteStudyTaskResponse = z.infer<
  typeof completeStudyTaskResponseSchema
>;
export type SubmitStudyQuizResponse = z.infer<
  typeof submitStudyQuizResponseSchema
>;

// ── Study stage / task ──

export const studyTaskBriefSchema = z.object({
  id: z.number().int(),
  curriculum_node_id: z.number().int().nullable(),
  day_index: z.number().int().nullable(),
  title: z.string(),
  description: z.string(),
  sort_order: z.number().int(),
  status: studyTaskStatus,
  created_at: z.number().int(),
});
export type StudyTaskBrief = z.infer<typeof studyTaskBriefSchema>;

export const studyStageDetailSchema = z.object({
  id: z.number().int(),
  study_subject_id: z.number().int(),
  title: z.string(),
  description: z.string(),
  sort_order: z.number().int(),
  status: studyStageStatus,
  total_tasks: z.number().int(),
  finished_tasks: z.number().int(),
  created_at: z.number().int(),
  tasks: z.array(studyTaskBriefSchema),
});
export type StudyStageDetail = z.infer<typeof studyStageDetailSchema>;
export const studyStageListSchema = z.array(studyStageDetailSchema);

export const knowledgeTreeTaskSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  status: studyTaskStatus,
});

export const knowledgeTreeNodeSchema = z.object({
  node_key: z.string(),
  parent_node_key: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  depth: z.number().int(),
  sort_order: z.number().int(),
  planned: z.boolean(),
  progress: z.number().int().min(0).max(100),
  available: z.boolean(),
  tasks: z.array(knowledgeTreeTaskSchema),
});

export const knowledgeTreeSchema = z.object({
  legacy: z.boolean(),
  template: z.object({ id: z.number().int(), canonical_name: z.string(), version: z.number().int() }).nullable(),
  sources: z.array(z.object({ platform: z.string(), institution: z.string(), source_url: z.string() })),
  nodes: z.array(knowledgeTreeNodeSchema),
});
export type KnowledgeTree = z.infer<typeof knowledgeTreeSchema>;
export type KnowledgeTreeNode = z.infer<typeof knowledgeTreeNodeSchema>;

export const studyTaskSchema = z.object({
  id: z.number().int(),
  study_stage_id: z.number().int(),
  curriculum_node_id: z.number().int().nullable(),
  day_index: z.number().int().nullable(),
  title: z.string(),
  description: z.string(),
  sort_order: z.number().int(),
  status: studyTaskStatus,
  knowledge_video_id: z.number().int().nullable(),
  interactive_html_id: z.number().int().nullable(),
  knowledge_explanation_id: z.number().int().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type StudyTask = z.infer<typeof studyTaskSchema>;

// ── Study quiz ──

export const studyQuizBriefSchema = z.object({
  id: z.number().int(),
  status: studyQuizStatus,
  total_problems: z.number().int(),
  correct_problems: z.number().int(),
  created_at: z.number().int(),
});
export const studyQuizListSchema = z.array(studyQuizBriefSchema);
export type StudyQuizBrief = z.infer<typeof studyQuizBriefSchema>;

export const studyQuizProblemSchema = z.object({
  id: z.number().int(),
  sort_order: z.number().int(),
  content: z.string(),
  choice_a: z.string(),
  choice_b: z.string(),
  choice_c: z.string(),
  choice_d: z.string(),
  answer: problemAnswer,
  explanation: z.string(),
  chosen_answer: problemAnswer.nullable(),
  bookmarked: z.boolean(),
  mistake_hidden: z.boolean(),
});
export type StudyQuizProblem = z.infer<typeof studyQuizProblemSchema>;

export const studyQuizDetailSchema = z.object({
  id: z.number().int(),
  status: studyQuizStatus,
  total_problems: z.number().int(),
  correct_problems: z.number().int(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  problems: z.array(studyQuizProblemSchema),
});
export type StudyQuizDetail = z.infer<typeof studyQuizDetailSchema>;

// ── Resources ──

const resourceBase = {
  id: z.number().int(),
  status: resourceStatus,
  prompt: z.string(),
  public: z.boolean(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
};

export const knowledgeVideoSchema = z.object({
  ...resourceBase,
  object_key: z.string().nullable(),
  bookmarked: z.boolean().optional().default(false),
});
export const codeVideoSchema = knowledgeVideoSchema;
export const interactiveHtmlSchema = knowledgeVideoSchema;

export const knowledgeExplanationSchema = z.object({
  ...resourceBase,
  content: z.string().nullable(),
  bookmarked: z.boolean(),
});

export type KnowledgeVideo = z.infer<typeof knowledgeVideoSchema>;
export type CodeVideo = z.infer<typeof codeVideoSchema>;
export type InteractiveHtml = z.infer<typeof interactiveHtmlSchema>;
export type KnowledgeExplanation = z.infer<typeof knowledgeExplanationSchema>;

// ── Recommendations ────────────────────────────────────────────────

export const recommendationResourceKind = z.enum([
  "knowledge-video",
  "code-video",
  "interactive-html",
]);
export type RecommendationResourceKind = z.infer<
  typeof recommendationResourceKind
>;

export const recommendedResourceSchema = z.object({
  catalog_id: z.number().int(),
  id: z.number().int(),
  title: z.string(),
  summary: z.string(),
  reasons: z.array(z.string()).min(1).max(2),
  learner_count: z.number().int().nonnegative().nullable(),
});
export type RecommendedResource = z.infer<typeof recommendedResourceSchema>;

export const taskRecommendationsSchema = z.object({
  eligible: z.boolean(),
  knowledge_point_title: z.string().nullable(),
  resources: z.object({
    knowledge_video: z.array(recommendedResourceSchema),
    interactive_html: z.array(recommendedResourceSchema),
  }),
});
export type TaskRecommendations = z.infer<typeof taskRecommendationsSchema>;

export const featuredResourcesSchema = z.array(
  z.object({
    catalog_id: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    summary: z.string(),
  }),
);
export type FeaturedResource = z.infer<typeof featuredResourcesSchema>[number];

export const chatQuestionSchema = z.object({ question: z.string() });
export const popularChatQuestionSchema = chatQuestionSchema.extend({
  learner_count: z.number().int().positive(),
});
export const taskChatContextSchema = z.object({
  course_title: z.string(),
  stage_title: z.string(),
  knowledge_point_title: z.string(),
  suggested_questions: z.array(chatQuestionSchema),
  popular_questions: z.array(popularChatQuestionSchema),
});
export type TaskChatContext = z.infer<typeof taskChatContextSchema>;

export const recommendedPlanSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  reason: z.string(),
  stage_count: z.number().int().positive(),
  task_count: z.number().int().positive(),
  estimated_weeks: z.number().int().positive().nullable(),
  stages: z.array(
    z.object({ title: z.string(), task_count: z.number().int().positive() }),
  ),
});
export type RecommendedPlan = z.infer<typeof recommendedPlanSchema>;

// ── Mistakes / bookmarks ──

export const quizProblemSourceSchema = z.object({
  quiz_id: z.number().int(),
  task_id: z.number().int(),
  task_title: z.string(),
  knowledge_point_title: z.string(),
  stage_id: z.number().int(),
  stage_title: z.string(),
  subject_id: z.number().int(),
  subject_name: z.string(),
});
export type QuizProblemSource = z.infer<typeof quizProblemSourceSchema>;

export const quizProblemReviewSchema = z.object({
  id: z.number().int(),
  sort_order: z.number().int(),
  content: z.string(),
  choice_a: z.string(),
  choice_b: z.string(),
  choice_c: z.string(),
  choice_d: z.string(),
  answer: problemAnswer,
  explanation: z.string(),
  chosen_answer: problemAnswer.nullable(),
  bookmarked: z.boolean(),
  mistake_hidden: z.boolean(),
  created_at: z.number().int(),
  source: quizProblemSourceSchema,
});
export const quizProblemReviewListSchema = z.array(quizProblemReviewSchema);
export type QuizProblemReview = z.infer<typeof quizProblemReviewSchema>;

export const bookmarkItemSchema = z.object({
  id: z.number().int(),
  kind: z.enum(["quiz_problem", "knowledge_video", "knowledge_explanation"]),
  title: z.string(),
  description: z.string(),
  knowledge_point_title: z.string().nullable(),
  source: quizProblemSourceSchema.nullable(),
  open_url: z.string().nullable(),
  created_at: z.number().int(),
});
export const bookmarkItemListSchema = z.array(bookmarkItemSchema);
export type BookmarkItem = z.infer<typeof bookmarkItemSchema>;
