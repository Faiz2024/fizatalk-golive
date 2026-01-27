const App = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/20 to-background p-4">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-4xl font-bold text-foreground">FizaTalk Bot</h1>
        <p className="text-muted-foreground text-lg">
          Telegram Random Chat Bot sedang berjalan.
        </p>
        <p className="text-sm text-muted-foreground">
          Untuk menggunakan bot, silakan cari <strong>@FizaTalkBot</strong> di Telegram.
        </p>
      </div>
    </div>
  );
};

export default App;
