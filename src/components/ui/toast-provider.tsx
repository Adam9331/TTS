import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white group-[.toaster]:text-[#1A1A1A] group-[.toaster]:border-black/5 group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-black/60",
          actionButton:
            "group-[.toast]:bg-[#5A5A40] group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-black/5 group-[.toast]:text-black/60",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
