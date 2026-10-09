import { toast } from "sonner";
import { useState } from "react";

import { 
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatImportRowError, normalizeImportRows } from "@/lib/csv-import";
import type { ImportTransactionRow } from "@/lib/schemas/transaction";

import { ImportTable } from "./import-table";

const MAX_ERRORS_SHOWN = 3;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const requiredOptions = [
  "amount",
  "date",
  "payee",
];

interface SelectedColumnsState {
  [key: string]: string | null;
};

type Props = {
  data: string[][];
  onCancel: () => void;
  onSubmit: (data: ImportTransactionRow[]) => void;
};

export const ImportCard = ({
  data,
  onCancel,
  onSubmit,
}: Props) => {
  const [selectedColumns, setSelectedColumns] = useState<SelectedColumnsState>({});

  const headers = data[0];
  const body = data.slice(1);

  const onTableHeadSelectChange = (
    columnIndex: number,
    value: string | null
  ) => {
    setSelectedColumns((prev) => {
      const newSelectedColumns = {...prev};

      for (const key in newSelectedColumns) {
        if (newSelectedColumns[key] === value) {
          newSelectedColumns[key] = null;
        }
      }

      if (value === "skip") {
        value = null;
      }

      newSelectedColumns[`column_${columnIndex}`] = value;
      return newSelectedColumns;
    });
  };

  const progress = Object.values(selectedColumns).filter(Boolean).length;

  const handleContinue = () => {
    const fieldByColumn = headers.map((_header, index) => selectedColumns[`column_${index}`] || null);

    const { rows, errors } = normalizeImportRows(body, fieldByColumn);

    // All-or-nothing: a partly imported file is harder to fix than a rejected one.
    if (errors.length > 0) {
      const hidden = errors.length - MAX_ERRORS_SHOWN;
      const lines = [
        ...errors.slice(0, MAX_ERRORS_SHOWN).map(formatImportRowError),
        ...(hidden > 0 ? [`…and ${hidden} more`] : []),
      ];

      // sonner 1.4 renders `description` as sanitized HTML, not as a React node:
      // JSX shows up as "[object Object]" and unescaped CSV text would be parsed as markup.
      toast.error(`Import blocked: ${errors.length} invalid value${errors.length === 1 ? "" : "s"}`, {
        description: escapeHtml(lines.join("\n")),
        classNames: { description: "whitespace-pre-line" },
      });
      return;
    }

    if (rows.length === 0) {
      toast.error("The file has no transactions to import");
      return;
    }

    onSubmit(rows);
  };

  return (
    <div className="max-w-screen-2xl mx-auto w-full pb-10 -mt-24">
      <Card className="border-none drop-shadow-sm">
        <CardHeader className="gap-y-2 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="text-xl line-clamp-1">
            Import Transaction
          </CardTitle>
          <div className="flex flex-col lg:flex-row gap-y-2 items-center gap-x-2">
            <Button 
              onClick={onCancel} 
              size="sm" 
              className="w-full lg:w-auto"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={progress < requiredOptions.length}
              onClick={handleContinue}
              className="w-full lg:w-auto"
            >
              Continue ({progress} / {requiredOptions.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ImportTable
            headers={headers}
            body={body}
            selectedColumns={selectedColumns}
            onTableHeadSelectChange={onTableHeadSelectChange}
          />
        </CardContent>
      </Card>
    </div>
  );
};
