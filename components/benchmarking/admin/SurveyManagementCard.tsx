"use client";

import { useState } from "react";
import type { BenchmarkingSurvey } from "@/lib/database.types";
import {
  createBenchmarkingSurvey,
  updateSurveyStatus,
  updateSurveyDates,
} from "@/lib/actions/benchmarking-admin";
import { useRouter } from "next/navigation";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700" },
  open: { label: "Open", color: "bg-green-100 text-green-800" },
  closed: { label: "Closed", color: "bg-amber-100 text-amber-800" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-800" },
  complete: { label: "Complete", color: "bg-gray-100 text-gray-700" },
};

const NEXT_STATUS: Record<string, { label: string; value: string } | null> = {
  draft: { label: "Open Survey", value: "open" },
  open: { label: "Close Survey", value: "closed" },
  closed: { label: "Begin Processing", value: "processing" },
  processing: { label: "Mark Complete", value: "complete" },
  complete: null,
};

interface SurveyManagementCardProps {
  surveys: BenchmarkingSurvey[];
}

export default function SurveyManagementCard({ surveys }: SurveyManagementCardProps) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [newFY, setNewFY] = useState(new Date().getFullYear() + 1);
  const [newTitle, setNewTitle] = useState("");
  const [newOpens, setNewOpens] = useState("");
  const [newCloses, setNewCloses] = useState("");

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    const result = await createBenchmarkingSurvey(
      newFY,
      newTitle || `FY${newFY} Benchmarking Survey`,
      newOpens || null,
      newCloses || null
    );
    if (result.success) {
      setShowCreate(false);
      setNewTitle("");
      setNewOpens("");
      setNewCloses("");
      router.refresh();
    } else {
      setError(result.error || "Failed to create survey");
    }
    setCreating(false);
  };

  const handleTransition = async (surveyId: string, newStatus: string) => {
    setTransitioning(true);
    setError(null);
    const result = await updateSurveyStatus(surveyId, newStatus);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || "Failed to update status");
    }
    setTransitioning(false);
  };

  const handleUpdateDates = async (surveyId: string, opensAt: string, closesAt: string) => {
    setError(null);
    const result = await updateSurveyDates(
      surveyId,
      opensAt || null,
      closesAt || null
    );
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || "Failed to update dates");
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Survey Management</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-sm px-3 py-1.5 bg-[#D60001] text-white rounded-lg hover:bg-[#B00001] transition-colors"
        >
          + New Survey
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Create New Survey</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fiscal Year</label>
              <input
                type="number"
                value={newFY}
                onChange={(e) => setNewFY(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={`FY${newFY} Benchmarking Survey`}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Opens At</label>
              <input
                type="date"
                value={newOpens}
                onChange={(e) => setNewOpens(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Closes At</label>
              <input
                type="date"
                value={newCloses}
                onChange={(e) => setNewCloses(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-1.5 bg-[#D60001] text-white text-sm rounded-lg hover:bg-[#B00001] disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-1.5 text-gray-600 text-sm rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Survey list */}
      {surveys.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6">
          No surveys yet. Create one to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {surveys.map((survey) => {
            const status = STATUS_LABELS[survey.status ?? "draft"];
            const next = NEXT_STATUS[survey.status ?? "draft"];

            return (
              <div
                key={survey.id}
                className="flex items-center justify-between p-4 border border-gray-100 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 text-sm">
                      {survey.title}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status?.color}`}
                    >
                      {status?.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>FY{survey.fiscal_year}</span>
                    {survey.opens_at && (
                      <span>
                        Opens: {new Date(survey.opens_at).toLocaleDateString("en-CA")}
                      </span>
                    )}
                    {survey.closes_at && (
                      <span>
                        Closes: {new Date(survey.closes_at).toLocaleDateString("en-CA")}
                      </span>
                    )}
                  </div>
                </div>

                {next && (
                  <button
                    onClick={() => handleTransition(survey.id, next.value)}
                    disabled={transitioning}
                    className="ml-4 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {transitioning ? "..." : next.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
