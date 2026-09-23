'use client';

/**
 * useAttachmentIntake — the shared document/image intake pipeline for the folio
 * editor (`FolioView`) and the folio chat panel (`FolioChatPanel`).
 *
 * Both hosts carried a near-identical copy of this pipeline: read a
 * picked file → text / data-URL / PDF text → portal state → commit it as a
 * versioned visual asset, a persistent reference file, or a co-pilot prompt
 * draft. This module is the single home for that logic.
 *
 * ── THE GOVERNING RULE IS BEHAVIOUR PRESERVATION ──────────────────────────
 * Everything here is a verbatim lift of the two copies: same accepted inputs,
 * same size/type handling, same portal states, same alert strings, same request
 * bodies, same order of operations. Where the two hosts had ALREADY drifted,
 * the difference is expressed as a required option rather than silently unified:
 *
 *   • `commitVisualAsset` — FolioView saves through `handleSaveModifiedCode`;
 *     FolioChatPanel runs its design-system PUT, then an inline folio PUT, then
 *     refetches. Different calls, different error strings.
 *   • `commitVisualAssetDeletion` — same split, for the asset-delete path.
 *   • `describeReferenceDeleteError` — FolioView surfaces `err.message`;
 *     FolioChatPanel always shows the static fallback string.
 *
 * Client-only: uses FileReader / window / document. Do not import server-side.
 */

import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { readTextFile, readImageAsDataURL } from '@/lib/unpack-files';
import type { HTMLFile } from '@/lib/db';

/** Files map shaped exactly as the folio save paths expect it. */
export type FolioFilesMap = { [filename: string]: string };

export interface AttachmentIntakeDeps {
  /** The loaded folio, or `null` while it is still loading. */
  project: HTMLFile | null;
  /** Refetch the folio from the server (the store's `fetchProject`). */
  fetchProject: () => Promise<void>;
  /** The host's alert dialog. */
  showAlert: (title: string, description: string) => void;
  /** The host's confirm dialog. */
  showConfirm: (
    title: string,
    description: string,
    onConfirm: () => void,
    variant?: 'default' | 'destructive'
  ) => void;
  /** Seeds the co-pilot composer draft (the store's `setChatDraft`). */
  setChatDraft: (draft: string) => void;

  /**
   * Persists an uploaded visual asset. NOT unified — the two hosts save
   * differently (FolioView → `handleSaveModifiedCode`; FolioChatPanel → an
   * inline PUT that also fires its design-system save first).
   */
  commitVisualAsset: (nextFilesMap: FolioFilesMap, commitMessage: string) => Promise<void>;

  /**
   * Persists a visual-asset deletion. NOT unified — FolioView reuses
   * `handleSaveModifiedCode`; FolioChatPanel does its own inline PUT.
   */
  commitVisualAssetDeletion: (
    nextFilesMap: FolioFilesMap,
    commitMessage: string
  ) => Promise<void>;

  /**
   * Builds the text shown when the reference-file delete throws. The two hosts
   * already differ here: FolioView shows `err.message`, FolioChatPanel always
   * shows the fallback. Return exactly what that host would have shown.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- both hosts' throw sites are untyped; FolioView reads `err.message` off the raw value
  describeReferenceDeleteError: (err: any, fallback: string) => string;
}

export interface AttachmentIntake {
  // Portal state (owned here so the two hosts share one implementation).
  isAttachmentPortalOpen: boolean;
  setIsAttachmentPortalOpen: (open: boolean) => void;
  isUploadingAsset: boolean;
  selectedAttachmentFile: File | null;
  setSelectedAttachmentFile: (file: File | null) => void;
  extractedContextText: string;
  setExtractedContextText: (text: string) => void;
  isExtractingText: boolean;
  attachmentIntent: 'enrich' | 'convert';
  setAttachmentIntent: (intent: 'enrich' | 'convert') => void;

  // Pipeline handlers.
  handleAttachmentFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleCommitAttachment: () => Promise<void>;
  handleDeleteReferenceFile: (filename: string) => void;
  handleDeleteVisualAsset: (filename: string) => void;
}

/** Minimal structural type for the CDN-injected pdf.js global. */
type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: { str: string }[] }>;
      }>;
    }>;
  };
};

const PDF_JS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function runExtraction(
  pdfjsLib: PdfJsLib,
  file: File,
  resolve: (val: string) => void,
  reject: (err: unknown) => void
) {
  void (async () => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';

      const maxPages = Math.min(pdf.numPages, 15);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(' ');
        fullText += `--- Page ${i} ---\n${pageText}\n\n`;
      }

      if (pdf.numPages > 15) {
        fullText += `\n[Context Truncated: Document contains ${pdf.numPages} pages; first 15 pages extracted to prevent context window overflow.]`;
      }

      resolve(fullText.trim());
    } catch (err) {
      console.error('PDF text extraction error:', err);
      reject(err);
    }
  })();
}

/**
 * Injects pdf.js from cdnjs on first use, then extracts up to 15 pages of text
 * with an explicit truncation notice. Rejects with the same free-form messages
 * the two hosts used before the lift.
 */
function extractTextFromPDF(file: File): Promise<string> {
  const pdfWindow = window as Window & { pdfjsLib?: PdfJsLib };
  return new Promise((resolve, reject) => {
    if (pdfWindow.pdfjsLib) {
      runExtraction(pdfWindow.pdfjsLib, file, resolve, reject);
      return;
    }

    const script = document.createElement('script');
    script.src = PDF_JS_SRC;
    script.onload = () => {
      const pdfjsLib = pdfWindow.pdfjsLib!;
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
      runExtraction(pdfjsLib, file, resolve, reject);
    };
    script.onerror = () =>
      reject(new Error('Failed to load secure client-side PDF.js extraction engine.'));
    document.head.appendChild(script);
  });
}

export function useAttachmentIntake(deps: AttachmentIntakeDeps): AttachmentIntake {
  const {
    project,
    fetchProject,
    showAlert,
    showConfirm,
    setChatDraft,
    commitVisualAsset,
    commitVisualAssetDeletion,
    describeReferenceDeleteError,
  } = deps;

  const [isAttachmentPortalOpen, setIsAttachmentPortalOpen] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [selectedAttachmentFile, setSelectedAttachmentFile] = useState<File | null>(null);
  const [extractedContextText, setExtractedContextText] = useState('');
  const [isExtractingText, setIsExtractingText] = useState(false);
  const [attachmentIntent, setAttachmentIntent] = useState<'enrich' | 'convert'>('enrich');

  const handleAttachmentFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedAttachmentFile(file);
    setExtractedContextText('');
    setAttachmentIntent('enrich');
    setIsAttachmentPortalOpen(true);

    const isImage = file.type.startsWith('image/');
    setIsExtractingText(true);
    try {
      if (isImage) {
        const dataUrl = await readImageAsDataURL(file);
        setExtractedContextText(dataUrl);
      } else if (file.name.endsWith('.pdf')) {
        const text = await extractTextFromPDF(file);
        setExtractedContextText(text);
      } else {
        const text = await readTextFile(file);
        setExtractedContextText(text);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- file-parsing errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      showAlert('File Parsing Error', err.message || 'LiveFolio was unable to extract contents from the selected file.');
    } finally {
      setIsExtractingText(false);
    }
  };

  const handleCommitAttachment = async () => {
    if (!project || !selectedAttachmentFile || !extractedContextText) return;
    setIsUploadingAsset(true);

    try {
      const filename = selectedAttachmentFile.name;
      const isImage = selectedAttachmentFile.type.startsWith('image/');

      if (isImage) {
        const latestVersion = project.versions[project.versions.length - 1];
        const assetPath = `assets/${filename}`;
        const nextFilesMap = { ...latestVersion.files, [assetPath]: extractedContextText };

        await commitVisualAsset(nextFilesMap, `Upload Visual Asset: ${filename}`);
        showAlert('Asset Uploaded', `Successfully integrated "${filename}" as a version-controlled visual asset under "assets/". You can reference it in your code or ask the co-pilot to insert it.`);
      } else {
        if (attachmentIntent === 'enrich') {
          const currentRefs = project.referenceFiles || [];
          const exists = currentRefs.some(r => r.filename === filename);
          if (exists) {
            showAlert('Duplicate Reference', 'A reference file with this exact name already exists in this folio context.');
            setIsUploadingAsset(false);
            return;
          }

          const updatedRefs = [...currentRefs, { filename, size: selectedAttachmentFile.size, content: extractedContextText }];
          const res = await fetch(`/api/files/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referenceFiles: updatedRefs })
          });

          if (res.ok) {
            await fetchProject();
            showAlert('Knowledge Base Enriched', `"${filename}" has been added to the folio's persistent context. The Co-pilot will automatically reference this text block in future queries.`);
          } else {
            throw new Error('Failed to write reference file database record.');
          }
        } else {
          // v1 setAiPrompt(...) — the composer draft now lives in the provider
          // store (ChatView reads it).
          setChatDraft(`Please analyze the attached reference document "${filename}" and build a completely new high-fidelity page/layout screen that maps its structure, elements, or context. Here is the text content from the file:\n\n${extractedContextText}`);
          showAlert('Ready to Convert', `Extracted text from "${filename}" has been loaded into your Co-Pilot prompt. Press Send to convert the document into a high-fidelity screen!`);
        }
      }

      setIsAttachmentPortalOpen(false);
      setSelectedAttachmentFile(null);
      setExtractedContextText('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- upload errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      console.error(err);
      showAlert('Upload Failed', err.message || 'An error occurred during upload.');
    } finally {
      setIsUploadingAsset(false);
    }
  };

  const handleDeleteReferenceFile = (filename: string) => {
    if (!project) return;

    showConfirm(
      'Remove Context File',
      `Are you sure you want to remove "${filename}" from the project knowledge base? The Co-pilot will no longer read its context.`,
      async () => {
        try {
          const currentRefs = project.referenceFiles || [];
          const updatedRefs = currentRefs.filter(r => r.filename !== filename);

          const res = await fetch(`/api/files/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referenceFiles: updatedRefs })
          });

          if (res.ok) {
            await fetchProject();
            showAlert('Knowledge Base Updated', `"${filename}" was successfully removed.`);
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- delete errors are thrown with free-form messages; each host formats them differently (see describeReferenceDeleteError)
        } catch (err: any) {
          showAlert('Delete Failed', describeReferenceDeleteError(err, 'Failed to remove the document.'));
        }
      },
      'destructive'
    );
  };

  const handleDeleteVisualAsset = (filename: string) => {
    if (!project) return;

    showConfirm(
      'Delete Visual Asset',
      `Are you sure you want to permanently delete the visual asset "${filename.replace('assets/', '')}" from this version checkpoint?`,
      async () => {
        try {
          const latestVersion = project.versions[project.versions.length - 1];
          const nextFilesMap = { ...latestVersion.files };
          delete nextFilesMap[filename];

          await commitVisualAssetDeletion(nextFilesMap, `Delete Visual Asset: ${filename.replace('assets/', '')}`);
          showAlert('Asset Deleted', `"${filename.replace('assets/', '')}" has been deleted.`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- delete errors are thrown with free-form messages; err.message is read
        } catch (err: any) {
          showAlert('Delete Failed', err.message || 'Failed to delete the visual asset.');
        }
      },
      'destructive'
    );
  };

  return {
    isAttachmentPortalOpen,
    setIsAttachmentPortalOpen,
    isUploadingAsset,
    selectedAttachmentFile,
    setSelectedAttachmentFile,
    extractedContextText,
    setExtractedContextText,
    isExtractingText,
    attachmentIntent,
    setAttachmentIntent,
    handleAttachmentFileChange,
    handleCommitAttachment,
    handleDeleteReferenceFile,
    handleDeleteVisualAsset,
  };
}
