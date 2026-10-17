import type { GlyphRecord } from '../../types/glyph';
import type { ExportFormat, Project } from '../../types/project';
import { validateFont, type ValidationResult } from '../font-validation/validate';
import { buildFontModel, fontFamilyName, fontFileName, type BuildReport } from './build-font';
import { writeOTF } from './otf-writer';
import { writeTTF } from './ttf-writer';

export interface GeneratedFont {
  format: ExportFormat;
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  report: Omit<BuildReport, 'model'>;
  validation: ValidationResult;
}

/** Builds, serializes and validates a font from a project's drawings. Throws only on writer bugs. */
export function generateFont(project: Project, records: GlyphRecord[], format: ExportFormat): GeneratedFont {
  const { model, ...report } = buildFontModel(project, records);
  const bytes = format === 'ttf' ? writeTTF(model) : writeOTF(model);
  const validation = validateFont(bytes, { familyName: fontFamilyName(project), chars: report.included, format });
  return {
    format,
    bytes,
    fileName: fontFileName(project, format),
    mime: format === 'ttf' ? 'font/ttf' : 'font/otf',
    report,
    validation,
  };
}

export { buildFontModel, fontFamilyName, fontFileName };
