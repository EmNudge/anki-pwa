function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

export function pluralizeWithCount(count: number, singular: string, plural: string) {
  return `${count} ${pluralize(count, singular, plural)}`;
}
