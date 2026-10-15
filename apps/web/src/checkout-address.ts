import type { Address } from "./api";

export function preferredAddressId(
  addresses: readonly Address[],
  currentId: string,
) {
  if (currentId && addresses.some((address) => address.id === currentId))
    return currentId;
  return addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id ?? "";
}
