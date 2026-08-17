import { describe, expect, it } from "vitest"

import { badgeVariants } from "./badge"
import { buttonVariants } from "./button"

describe("primitivos alinhados ao DESIGN.md", () => {
  it("mantém CTA primário com on-primary e raio de botão, nunca pill", () => {
    const primary = buttonVariants({ variant: "default", size: "default" })
    const compact = buttonVariants({ variant: "default", size: "sm" })

    expect(primary).toContain("bg-primary")
    expect(primary).toContain("text-primary-foreground")
    expect(primary).toContain("rounded-md")
    expect(compact).toContain("rounded-md")
    expect(`${primary} ${compact}`).not.toContain("rounded-full")
  })

  it("usa tokens de texto em superfícies cromáticas", () => {
    expect(buttonVariants({ variant: "destructive" })).toContain(
      "text-destructive-foreground",
    )
    expect(badgeVariants({ variant: "tagDup" })).toContain("text-on-dark")
  })
})
