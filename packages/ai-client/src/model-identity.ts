/** Only explicitly observed provider aliases are accepted; never strip arbitrary suffixes. */
export function returnedModelMatches(
  requested: string,
  returned: unknown,
): boolean {
  return (
    returned === null ||
    returned === requested ||
    (requested === "gpt-6-astra/u64" && returned === "gpt-6-astra") ||
    (requested === "gpt-5.6-sol/u40" && returned === "gpt-5.6-sol")
  );
}
