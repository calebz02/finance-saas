import { parseCsvDate } from "@/lib/dates";
import { parseMoneyToCents } from "@/lib/money";
import {
  importTransactionRowSchema,
  type ImportTransactionRow,
} from "@/lib/schemas/transaction";

export type ImportRowError = {
  /** 1-based row in the file, counting the header as row 1 (matches spreadsheet numbering). */
  row: number;
  field: string;
  value: string;
  message: string;
};

export type NormalizedImport = {
  rows: ImportTransactionRow[];
  errors: ImportRowError[];
};

/**
 * Turns raw CSV cells into canonical import rows (integer cents, "YYYY-MM-DD").
 * `fieldByColumn[i]` is the field chosen for column i, or null to skip it.
 * The result has no `accountId`; the caller adds it once the user picks one.
 */
export function normalizeImportRows(
  body: string[][],
  fieldByColumn: (string | null)[],
): NormalizedImport {
  const rows: ImportTransactionRow[] = [];
  const errors: ImportRowError[] = [];

  body.forEach((cells, index) => {
    const row = index + 2;
    const fields: Record<string, string> = {};
    cells.forEach((cell, columnIndex) => {
      const field = fieldByColumn[columnIndex];
      if (field) fields[field] = cell;
    });

    // Blank lines (papaparse emits [""] for a trailing newline) are not transactions.
    if (!Object.values(fields).some((cell) => cell.trim() !== "")) return;

    const amountValue = fields.amount ?? "";
    const dateValue = fields.date ?? "";
    const amount = parseMoneyToCents(amountValue);
    const date = parseCsvDate(dateValue);

    if (!amount.ok) errors.push({ row, field: "amount", value: amountValue, message: amount.error });
    if (!date.ok) errors.push({ row, field: "date", value: dateValue, message: date.error });
    if (!amount.ok || !date.ok) return;

    const parsed = importTransactionRowSchema.safeParse({
      amount: amount.cents,
      date: date.date,
      payee: fields.payee ?? "",
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".") || "row";
        errors.push({ row, field, value: fields[field] ?? "", message: issue.message });
      }
      return;
    }

    rows.push(parsed.data);
  });

  return { rows, errors };
}

export function formatImportRowError({ row, field, value, message }: ImportRowError) {
  return value.trim() === ""
    ? `Row ${row}: ${field} — ${message}`
    : `Row ${row}: ${field} — ${message} (got "${value}")`;
}
