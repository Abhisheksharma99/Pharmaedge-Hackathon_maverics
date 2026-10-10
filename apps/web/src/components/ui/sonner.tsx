"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // Light theme only for now; dark tokens exist but no theme switcher yet.
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-[16px]" />
        ),
        info: (
          <InfoIcon className="size-[16px]" />
        ),
        warning: (
          <TriangleAlertIcon className="size-[16px]" />
        ),
        error: (
          <OctagonXIcon className="size-[16px]" />
        ),
        loading: (
          <Loader2Icon className="size-[16px] animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
