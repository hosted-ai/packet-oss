/**
 * Dashboard hooks - extracted from DashboardContent for better maintainability
 */

export { useDashboardData } from "./useDashboardData";
export type { DashboardDataState, DashboardDataActions } from "./useDashboardData";

export { useDashboardActions } from "./useDashboardActions";
export type { DashboardActionsState, DashboardActionsCallbacks } from "./useDashboardActions";

export { useModals } from "./useModals";
export type { ModalsState, ModalsActions, TabType } from "./useModals";
