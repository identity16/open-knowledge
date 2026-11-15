#include <stdio.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
  if (argc < 2) { fprintf(stderr, "usage: ok-service <program> [args...]\n"); return 64; }
  execv(argv[1], argv + 1);
  perror("execv");
  return 1;
}
