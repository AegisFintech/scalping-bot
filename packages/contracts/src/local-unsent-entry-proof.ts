/** Atomic local evidence only; never a broker acknowledgement or a fill. */
export interface LocalUnsentEntryProof {
  readonly orderId: string;
  readonly groupId: string;
  readonly accountId: string;
  readonly symbolId: string;
  readonly clientId: string;
  readonly reason: string;
  readonly sourceUpdatedAt: string;
  readonly recordedAt: string;
}
