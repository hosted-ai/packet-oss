/**
 * Filter Panel Component
 *
 * Collapsible filter panel for HuggingFace model search.
 *
 * @module components/huggingface-tab/FilterPanel
 */

"use client";

interface FilterOption {
  value: string;
  label: string;
}

interface FilterPanelProps {
  selectedTask: string;
  setSelectedTask: (task: string) => void;
  selectedLibrary: string;
  setSelectedLibrary: (library: string) => void;
  selectedParamSize: string;
  setSelectedParamSize: (size: string) => void;
  filterOptions: {
    tasks: FilterOption[];
    libraries: FilterOption[];
    paramSizes: FilterOption[];
  } | null;
}

export function FilterPanel({
  selectedTask,
  setSelectedTask,
  selectedLibrary,
  setSelectedLibrary,
  selectedParamSize,
  setSelectedParamSize,
  filterOptions,
}: FilterPanelProps) {
  return (
    <div className="mt-3 p-4 bg-zinc-50 rounded-lg border border-[var(--line)]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Task Filter */}
        <div>
          <label className="block text-sm font-medium text-[var(--ink)] mb-1.5">
            Task
          </label>
          <select
            value={selectedTask}
            onChange={(e) => setSelectedTask(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--line)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
          >
            <option value="">All Tasks</option>
            {filterOptions?.tasks?.map((task) => (
              <option key={task.value} value={task.value}>
                {task.label}
              </option>
            )) || (
              <>
                <option value="text-generation">Text Generation</option>
                <option value="text2text-generation">Text-to-Text</option>
                <option value="image-text-to-text">Image-Text-to-Text</option>
                <option value="image-to-text">Image-to-Text</option>
                <option value="text-to-image">Text-to-Image</option>
                <option value="text-to-video">Text-to-Video</option>
                <option value="text-to-speech">Text-to-Speech</option>
                <option value="automatic-speech-recognition">
                  Speech Recognition
                </option>
              </>
            )}
          </select>
        </div>

        {/* Library Filter */}
        <div>
          <label className="block text-sm font-medium text-[var(--ink)] mb-1.5">
            Library
          </label>
          <select
            value={selectedLibrary}
            onChange={(e) => setSelectedLibrary(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--line)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
          >
            <option value="">All Libraries</option>
            {filterOptions?.libraries?.map((lib) => (
              <option key={lib.value} value={lib.value}>
                {lib.label}
              </option>
            )) || (
              <>
                <option value="transformers">Transformers</option>
                <option value="diffusers">Diffusers</option>
                <option value="safetensors">Safetensors</option>
                <option value="gguf">GGUF</option>
                <option value="vllm">vLLM</option>
              </>
            )}
          </select>
        </div>

        {/* Parameter Size Filter */}
        <div>
          <label className="block text-sm font-medium text-[var(--ink)] mb-1.5">
            Model Size
          </label>
          <select
            value={selectedParamSize}
            onChange={(e) => setSelectedParamSize(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--line)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
          >
            <option value="">All Sizes</option>
            {filterOptions?.paramSizes?.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            )) || (
              <>
                <option value="0-1">&lt; 1B</option>
                <option value="1-3">1-3B</option>
                <option value="3-7">3-7B</option>
                <option value="7-14">7-14B</option>
                <option value="14-32">14-32B</option>
                <option value="32-70">32-70B</option>
                <option value="70-200">70-200B</option>
                <option value="200+">&gt; 200B</option>
              </>
            )}
          </select>
        </div>
      </div>

      {/* Active Filters Display */}
      {(selectedTask || selectedLibrary || selectedParamSize) && (
        <div className="mt-3 pt-3 border-t border-[var(--line)] flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--muted)]">Active:</span>
          {selectedTask && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-[var(--line)] rounded-full">
              {filterOptions?.tasks?.find((t) => t.value === selectedTask)
                ?.label || selectedTask}
              <button
                onClick={() => setSelectedTask("")}
                className="hover:text-red-500"
              >
                ×
              </button>
            </span>
          )}
          {selectedLibrary && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-[var(--line)] rounded-full">
              {filterOptions?.libraries?.find(
                (l) => l.value === selectedLibrary
              )?.label || selectedLibrary}
              <button
                onClick={() => setSelectedLibrary("")}
                className="hover:text-red-500"
              >
                ×
              </button>
            </span>
          )}
          {selectedParamSize && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-[var(--line)] rounded-full">
              {filterOptions?.paramSizes?.find(
                (s) => s.value === selectedParamSize
              )?.label || selectedParamSize}
              <button
                onClick={() => setSelectedParamSize("")}
                className="hover:text-red-500"
              >
                ×
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setSelectedTask("");
              setSelectedLibrary("");
              setSelectedParamSize("");
            }}
            className="text-xs text-[var(--blue)] hover:underline ml-auto"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
