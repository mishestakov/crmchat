import Loader from "./ui/loader";

export function LoadingScreen() {
  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center">
      <Loader />
    </div>
  );
}
