"use client";

import { Loader2, Save, CheckCircle, XCircle } from "lucide-react";
import { Button } from "./Button";

export interface SaveBarProps {
  saving:  boolean;
  saved:   boolean;
  err:     string;
  onSave:  () => void;
  label?:  string;
}

export function SaveBar({ saving, saved, err, onSave, label = "Сохранить" }: SaveBarProps) {
  return (
    <div className="flex items-center gap-3 pt-2 border-t border-border-main mt-2">
      <Button
        variant="primary"
        onClick={onSave}
        loading={saving}
        icon={<Save className="w-3.5 h-3.5" />}
      >
        {label}
      </Button>
      {saved && (
        <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" /> Сохранено
        </span>
      )}
      {err && (
        <span className="text-xs text-red-500 flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5" /> {err}
        </span>
      )}
    </div>
  );
}

export default SaveBar;
