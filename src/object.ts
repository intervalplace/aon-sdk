export type AonObject = {
  objectType: string;
  schemaVersion: string;
  namespace: string;
  createdAt: number;
  creator?: string;
  references: string[];
  payload?: any;
  objectHash?: string;
  signature?: any;
};
