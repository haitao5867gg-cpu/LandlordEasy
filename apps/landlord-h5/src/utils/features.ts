// 未端到端验收功能的生产开关(2026-09-22 GasCan拍板:没在dev走通的功能
// 一律不上生产,他在dev测完后通知放开)。dev的.env显式置
// VITE_SHOW_UNVERIFIED_FEATURES=1;生产不配置=全部隐藏。
// 涉及:退租/续签、待处理申请(报修/退租/换租审批)、维修记录、支出、
// 经营报表、收款码设置、追加滞纳金。
export const UNVERIFIED_FEATURES_ENABLED =
  import.meta.env.VITE_SHOW_UNVERIFIED_FEATURES === '1';
