/**
 * Filter Panel Component
 *
 * Filter controls for HuggingFace search.
 *
 * @module huggingface/FilterPanel
 */

"use client";

import type { FilterOptions } from "./types";

interface FilterPanelProps {
  selectedTask: string;
  setSelectedTask: (v: string) => void;
  selectedLibrary: string;
  setSelectedLibrary: (v: string) => void;
  selectedParamSize: string;
  setSelectedParamSize: (v: string) => void;
  filterOptions: FilterOptions | null;
}

const DEFAULT_TASKS = [
  { value: "text-generation", label: "Text Generation" },
  { value: "text2text-generation", label: "Text-to-Text" },
  { value: "image-text-to-text", label: "Image-Text-to-Text" },
  { value: "image-to-text", label: "Image-to-Text" },
  { value: "text-to-image", label: "Text-to-Image" },
  { value: "text-to-video", label: "Text-to-Video" },
  { value: "text-to-speech", label: "Text-to-Speech" },
  { value: "automatic-speech-recognition", label: "Speech Recognition" },
  { value: "conversational", label: "Conversational" },
];

const DEFAULT_LIBRARIES = [
  { value: "transformers", label: "Transformers" },
  { value: "diffusers", label: "Diffusers" },
  { value: "safetensors", label: "Safetensors" },
  { value: "gguf", label: "GGUF" },
  { value: "vllm", label: "vLLM" },
];

const DEFAULT_PARAM_SIZES = [
  { value: "0-1", label: "< 1B" },
  { value: "1-3", label: "1-3B" },
  { value: "3-7", label: "3-7B" },
  { value: "7-14", label: "7-14B" },
  { value: "14-32", label: "14-32B" },
  { value: "32-70", label: "32-70B" },
  { value: "70-200", label: "70-200B" },
  { value: "200+", label: "> 200B" },
];

export function FilterPanel({
  selectedTask,
  setSelectedTask,
  selectedLibrary,
  setSelectedLibrary,
  selectedParamSize,
  setSelectedParamSize,
  filterOptions,
}: FilterPanelProps) {
  const tasks = filterOptions?.tasks || DEFAULT_TASKS;
  const libraries = filterOptions?.libraries || DEFAULT_LIBRARIES;
  const paramSizes = filterOptions?.paramSizes || DEFAULT_PARAM_SIZES;

  const hasActiveFilters = selectedTask || selectedLibrary || selectedParamSize;

  return (
    <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Task Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Task
          </label>
          <select
            value={selectedTask}
            onChange={(e) => setSelectedTask(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
          >
            <option value="">All Tasks</option>
            {tasks.map((task) => (
              <option key={task.value} value={task.value}>
                {task.label}
              </option>
            ))}
          </select>
        </div>

        {/* Library Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Library
          </label>
          <select
            value={selectedLibrary}
            onChange={(e) => setSelectedLibrary(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
          >
            <option value="">All Libraries</option>
            {libraries.map((lib) => (
              <option key={lib.value} value={lib.value}>
                {lib.label}
              </option>
            ))}
          </select>
        </div>

        {/* Parameter Size Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Model Size
          </label>
          <select
            value={selectedParamSize}
            onChange={(e) => setSelectedParamSize(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
          >
            <option value="">All Sizes</option>
            {paramSizes.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap gap-2 items-center">
          <span className="text-sm text-gray-500">Active:</span>
          {selectedTask && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-100 text-teal-700 rounded-full text-sm">
              {tasks.find((t) => t.value === selectedTask)?.label || selectedTask}
              <button
                onClick={() => setSelectedTask("")}
                className="hover:text-teal-900"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          )}
          {selectedLibrary && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-100 text-teal-700 rounded-full text-sm">
              {libraries.find((l) => l.value === selectedLibrary)?.label ||
                selectedLibrary}
              <button
                onClick={() => setSelectedLibrary("")}
                className="hover:text-teal-900"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          )}
          {selectedParamSize && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-100 text-teal-700 rounded-full text-sm">
              {paramSizes.find((s) => s.value === selectedParamSize)?.label ||
                selectedParamSize}
              <button
                onClick={() => setSelectedParamSize("")}
                className="hover:text-teal-900"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setSelectedTask("");
              setSelectedLibrary("");
              setSelectedParamSize("");
            }}
            className="text-sm text-gray-500 hover:text-gray-700 ml-2"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
