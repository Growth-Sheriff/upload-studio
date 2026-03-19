/**
 * ═══════════════════════════════════════════════════════════
 * Mockup Worker — BullMQ Job Processor
 * ═══════════════════════════════════════════════════════════
 * 
 * Listens on `us-mockup-queue` and processes mockup generation jobs.
 * 
 * Job Data Schema:
 * {
 *   uploadId: string,       — Upload Studio upload ID
 *   shopDomain: string,     — Tenant identifier
 *   artworkUrl: string,     — CDN URL of customer artwork
 *   artworkKey: string,     — R2 key of customer artwork
 *   garmentTypes: string[], — ["tshirt","hoodie","hat","polo","totebag","apron"]
 *   garmentColor?: string,  — Hex color for garment tinting
 *   templates?: Array<{     — Custom templates (if seller uploaded PSD)
 *     garmentType: string,
 *     templateKey: string,
 *     printArea: { topPct, leftPct, widthPct, maxHeightPct }
 *   }>,
 *   callbackUrl?: string,   — Webhook URL to notify Upload Studio API
 * }
 * 
 * Result:
 * {
 *   mockups: Array<{
 *     garmentType: string,
 *     url: string,
 *     width: number,
 *     height: number,
 *     sizeBytes: number,
 *   }>
 * }
 */

import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "./redis.js";
import { downloadFromR2, uploadToR2 } from "./r2-storage.js";
import {
  compositeOnTemplate,
  DEFAULT_PRINT_AREAS,
  type PrintArea,
} from "./compositor.js";
import { getDefaultTemplateBuffer } from "./default-templates.js";

// ─── Types ──────────────────────────────────────────────

interface MockupJobData {
  uploadId: string;
  shopDomain: string;
  artworkUrl: string;
  artworkKey: string;
  garmentTypes: string[];
  garmentColor?: string;
  templates?: Array<{
    garmentType: string;
    templateKey: string;
    printArea: PrintArea;
  }>;
  callbackUrl?: string;
}

interface MockupResult {
  garmentType: string;
  url: string;
  key: string;
  width: number;
  height: number;
  sizeBytes: number;
}

// ─── Worker Class ───────────────────────────────────────

export class MockupWorker {
  private worker: Worker | null = null;
  private concurrency: number;

  constructor(concurrency: number = 2) {
    this.concurrency = concurrency;
  }

  async start(): Promise<void> {
    const queueName = process.env.QUEUE_NAME || "us-mockup-queue";

    this.worker = new Worker<MockupJobData>(
      queueName,
      async (job) => this.processJob(job),
      {
        connection: getRedisConnection() as any,
        concurrency: this.concurrency,
        limiter: {
          max: 10,
          duration: 60_000, // Max 10 jobs per minute
        },
      }
    );

    this.worker.on("completed", (job) => {
      console.log(
        `[us-mockup] ✅ Job ${job.id} completed (${job.data.shopDomain})`
      );
    });

    this.worker.on("failed", (job, err) => {
      console.error(
        `[us-mockup] ❌ Job ${job?.id} failed:`,
        err.message
      );
    });

    this.worker.on("error", (err) => {
      console.error("[us-mockup] Worker error:", err);
    });
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      console.log("[us-mockup] Worker stopped");
    }
  }

  // ─── Job Processor ──────────────────────────────────

  private async processJob(job: Job<MockupJobData>): Promise<{ mockups: MockupResult[] }> {
    const { uploadId, shopDomain, artworkKey, garmentTypes, garmentColor, templates, callbackUrl } =
      job.data;

    console.log(
      `[us-mockup] Processing job ${job.id}: upload=${uploadId}, shop=${shopDomain}, garments=${garmentTypes.join(",")}`
    );

    await job.updateProgress(5);

    // 1. Download customer artwork from R2
    let artworkBuffer: Buffer;
    try {
      artworkBuffer = await downloadFromR2(artworkKey);
      console.log(
        `[us-mockup] Downloaded artwork: ${artworkKey} (${(artworkBuffer.length / 1024).toFixed(1)}KB)`
      );
    } catch (err) {
      throw new Error(`Failed to download artwork: ${(err as Error).message}`);
    }

    await job.updateProgress(20);

    // 2. Generate mockups for each garment type
    const mockups: MockupResult[] = [];
    const totalGarments = garmentTypes.length;

    for (let i = 0; i < garmentTypes.length; i++) {
      const garmentType = garmentTypes[i];
      const progressPct = 20 + Math.round(((i + 1) / totalGarments) * 60);

      try {
        // Get template (custom or default)
        let templateBuffer: Buffer;
        let printArea: PrintArea;

        const customTemplate = templates?.find(
          (t) => t.garmentType === garmentType
        );

        if (customTemplate) {
          // Seller uploaded custom template
          templateBuffer = await downloadFromR2(customTemplate.templateKey);
          printArea = customTemplate.printArea;
          console.log(`[us-mockup] Using custom template for ${garmentType}`);
        } else {
          // Use default built-in template
          templateBuffer = await getDefaultTemplateBuffer(garmentType);
          printArea = DEFAULT_PRINT_AREAS[garmentType] || DEFAULT_PRINT_AREAS.tshirt;
          console.log(`[us-mockup] Using default template for ${garmentType}`);
        }

        // 3. Composite
        const result = await compositeOnTemplate({
          templateBuffer,
          artworkBuffer,
          printArea,
          garmentColor,
          outputWidth: 800,
          quality: 85,
        });

        // 4. Upload to R2
        const outputKey = `mockups/${shopDomain}/${uploadId}/${garmentType}.png`;
        const url = await uploadToR2(outputKey, result.buffer);

        mockups.push({
          garmentType,
          url,
          key: outputKey,
          width: result.width,
          height: result.height,
          sizeBytes: result.sizeBytes,
        });

        console.log(
          `[us-mockup] ✅ ${garmentType}: ${result.width}x${result.height} (${(result.sizeBytes / 1024).toFixed(1)}KB)`
        );
      } catch (err) {
        console.error(
          `[us-mockup] ❌ Failed ${garmentType}:`,
          (err as Error).message
        );
        // Continue with other garments — don't fail the whole job
      }

      await job.updateProgress(progressPct);
    }

    await job.updateProgress(85);

    // 5. Notify Upload Studio API via callback
    if (callbackUrl && mockups.length > 0) {
      try {
        await fetch(callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId,
            shopDomain,
            mockups,
            status: "completed",
          }),
        });
        console.log(`[us-mockup] Callback sent to ${callbackUrl}`);
      } catch (err) {
        console.warn(`[us-mockup] Callback failed:`, (err as Error).message);
        // Don't fail job for callback errors
      }
    }

    await job.updateProgress(100);

    return { mockups };
  }
}
