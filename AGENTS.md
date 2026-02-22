# TypeScript style guide
- Whenever possible, avoid comments.
- Keep variables named specifically to their purpose.
- Avoid mutation. This means no "let" and do not mutate objects.
  - Do not use Array.reduce() since this makes code harder to read
  - Feel free to use modern web methods like Object.groupBy and Array.flatMap
  - Avoid using .set() in a Map and .push() in an array
  - If code would get less clear by following this list, make an exception
- Have functions with early returns instead of many if-else branches
- do not use .forEach, instead use "for ... of" 
  - Try array.entries() instead of a "for let" loop if possible
- Use utility methods that are self-contained and pure. They should take in all arguments and be testable.
- Avoid using classes where possible. 
  - Instead, try to model the problem with a state storage and a series of utility functions
- Avoid type assertions where possible.
  - Instead, prefer early returns or throwing errors. Use assertion functions that create type guards
  - Never use "as any" - use something like zod to runtime validate the schema if we want to access a property
- Avoid deeply nested ternaries
- Use object types instead of utility functions when translating an enum to another type
- Avoid using TS enum types, use string unions
- Avoid using TS decorators or "private/public" descriptors

# Vue style guide
- Use Vue 3 Composition API with `<script setup lang="ts">`
- Try to use props instead of global stores unless data needs to be shared between many components
- If a method handler is only a few lines long and only used once, inline it in the place it's used
- Use design system components from `src/design-system/` instead of raw HTML elements