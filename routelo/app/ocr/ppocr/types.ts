export type PpOcrPoint = {
  x: number;
  y: number;
};

export type PpOcrRegion = {
  score: number;
  cornerPoints: [PpOcrPoint, PpOcrPoint, PpOcrPoint, PpOcrPoint];
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type PpOcrLine = {
  text: string;
  confidence: number;
  boundingBox: PpOcrRegion['boundingBox'];
  cornerPoints: PpOcrRegion['cornerPoints'];
};

export type PpOcrResult = {
  engine: 'ppocrv5';
  modelVersion: string;
  fullText: string;
  lines: PpOcrLine[];
  processingMs: number;
  orientationDegrees?: 0 | 90 | 180 | 270;
  variantsCompared?: number;
  preprocessProfileId?: string;
  diagnostics?: {
    preprocessProfileId: string;
    selectedOrientationDegrees: 0 | 90 | 180 | 270;
    regionCount: number;
    acceptedLineCount: number;
    rawTextLength: number;
    orientationCandidates: Array<{
      orientation: 0 | 90 | 180 | 270;
      regionCount: number;
      acceptedLineCount: number;
      averageLineConfidence: number;
      meaningfulTextLength: number;
      processingMs: number;
    }>;
  };
};
