/** Decide si abrir el popup de cliente al agregar un ítem: solo al primero de la
 *  venta, si no hay cliente y no se preguntó antes en esta venta. */
export function shouldPromptCustomer(cartWasEmpty: boolean, customerId: string | null, alreadyAsked: boolean): boolean {
  return cartWasEmpty && customerId === null && !alreadyAsked;
}
