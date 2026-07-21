/** 统一响应格式 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

/** 分页请求参数 */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

/** 分页响应 */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 房型模板默认费用项 */
export interface FeeItem {
  name: string;
  amount: number;
}
