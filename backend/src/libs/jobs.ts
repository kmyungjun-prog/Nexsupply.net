/**
 * Job queue interface. Phase-C: in-process runner for blueprint_pipeline.
 * TODO: Cloud Tasks / PubSub + DLQ for production.
 */

export type JobName =
  | "recalculate_resolved_view"
  | "blueprint_pipeline"
  | "ocr_extract"
  | "crawl_sources"
  | "generate_pdf";

export type EnqueueJobInput = {
  name: JobName;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
};

export interface JobQueue {
  enqueue(input: EnqueueJobInput): Promise<void>;
}

export class NoopJobQueue implements JobQueue {
  async enqueue(_input: EnqueueJobInput): Promise<void> {
    return;
  }
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/** Phase-C: in-process runner. TODO: Cloud Tasks / PubSub + DLQ. */
export function createInProcessJobQueue(handlers: Partial<Record<JobName, JobHandler>>): JobQueue {
  return {
    async enqueue(input: EnqueueJobInput): Promise<void> {
      const handler = handlers[input.name];
      if (handler) {
        await handler({
          ...input.payload,
          idempotencyKey: input.idempotencyKey ?? (input.payload?.idempotencyKey as string),
        });
      }
    },
  };
}

let _queue: JobQueue = new NoopJobQueue();

export function setJobQueue(q: JobQueue): void {
  _queue = q;
}

export const jobs: JobQueue = {
  async enqueue(input: EnqueueJobInput): Promise<void> {
    await _queue.enqueue(input);
  },
};
