export interface ContractFacilities {
  airConditioner: boolean;
  refrigerator: boolean;
  washingMachine: boolean;
  waterHeater: boolean;
  gasStove: boolean;
  television: boolean;
  shower: boolean;
  rangeHood: boolean;
  bed: boolean;
  table: boolean;
  chair: boolean;
  sofa: boolean;
}

export interface ContractPdfData {
  landlordName: string;
  landlordIdCard: string;
  landlordPhone: string;
  tenantName: string;
  tenantIdCard: string;
  tenantPhone: string;
  propertyAddress: string;
  leaseStartDate: Date | string;
  leaseEndDate: Date | string;
  monthlyRent: number;
  paymentCycle: string;
  depositAmount: number;
  penaltyMonths: number;
  overdueToleranceDays: number;
  cleaningFee: number;
  renewalNoticeDays: number;
  electricityMeterReading?: number;
  waterMeterReading?: number;
  gasMeterReading?: number;
  facilities: ContractFacilities;
  extraTerms?: string;
  contractNumber?: string;
}
